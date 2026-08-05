using System.Collections.Concurrent;
using System.Text.Json;
using Amazon;
using Amazon.Runtime;
using Amazon.SQS;
using Amazon.SQS.Model;

namespace SqsWorkbench.Api.Sqs;

/// <summary>
/// Thin wrapper around the AWS SQS SDK client. The client is recreated lazily
/// whenever the connection settings change, so the UI can point the app at any
/// SQS-compatible endpoint (AWS, LocalStack, ElasticMQ, ...) on the fly.
/// </summary>
public class SqsService
{
    private readonly SettingsStore _store;
    private readonly ILogger<SqsService> _logger;
    private readonly object _clientLock = new();

    private AmazonSQSClient? _client;
    private string? _clientKey;

    public SqsService(SettingsStore store, ILogger<SqsService> logger)
    {
        _store = store;
        _logger = logger;
    }

    private async Task<AmazonSQSClient> GetClientAsync(CancellationToken ct)
    {
        var s = await _store.GetAsync();
        var key = $"{s.Endpoint}|{s.Region}|{s.AccessKey}|{s.SecretKey}";

        lock (_clientLock)
        {
            if (_client is not null && _clientKey == key)
            {
                return _client;
            }
        }

        var config = new AmazonSQSConfig
        {
            ServiceURL = string.IsNullOrWhiteSpace(s.Endpoint) ? null : s.Endpoint.Trim().TrimEnd('/'),
            AuthenticationRegion = string.IsNullOrWhiteSpace(s.Region) ? "us-east-1" : s.Region.Trim()
        };

        // When no custom endpoint is configured, fall back to the regular region-based routing.
        if (string.IsNullOrWhiteSpace(config.ServiceURL))
        {
            config.RegionEndpoint = ResolveRegion(s.Region);
        }

        AmazonSQSClient client;
        if (!string.IsNullOrEmpty(s.AccessKey) && !string.IsNullOrEmpty(s.SecretKey))
        {
            client = new AmazonSQSClient(new BasicAWSCredentials(s.AccessKey, s.SecretKey), config);
        }
        else
        {
            // Fall back to the SDK default credential chain (env vars, profile, EC2 role...)
            client = new AmazonSQSClient(config);
        }

        lock (_clientLock)
        {
            if (_client is not null && _clientKey == key)
            {
                // Another request already created the client for these settings — use theirs.
                client.Dispose();
                return _client;
            }

            // Retired clients are intentionally NOT disposed here: an in-flight request may
            // still be using the previous client after a settings change. The GC reclaims it.
            _client = client;
            _clientKey = key;
        }

        _logger.LogInformation("SQS client (re)created for endpoint {Endpoint} / region {Region}", s.Endpoint, s.Region);
        return client;
    }

    private static RegionEndpoint ResolveRegion(string? region)
    {
        var name = string.IsNullOrWhiteSpace(region) ? "us-east-1" : region.Trim();
        try
        {
            return RegionEndpoint.GetBySystemName(name);
        }
        catch (Exception)
        {
            return RegionEndpoint.USEast1;
        }
    }

    public static string GetNameFromUrl(string queueUrl)
    {
        var trimmed = queueUrl.TrimEnd('/');
        var idx = trimmed.LastIndexOf('/');
        return idx >= 0 ? trimmed[(idx + 1)..] : trimmed;
    }

    // ---------------------------------------------------------------- queues

    public async Task<List<QueueItem>> ListQueuesAsync(string? prefix, CancellationToken ct)
    {
        var client = await GetClientAsync(ct);
        var result = new List<QueueItem>();
        string? nextToken = null;

        do
        {
            var resp = await client.ListQueuesAsync(new ListQueuesRequest
            {
                QueueNamePrefix = string.IsNullOrWhiteSpace(prefix) ? null : prefix,
                NextToken = nextToken,
                MaxResults = 100
            }, ct);

            foreach (var url in resp.QueueUrls)
            {
                result.Add(new QueueItem { Name = GetNameFromUrl(url), Url = url });
            }

            nextToken = resp.NextToken;
        }
        while (!string.IsNullOrEmpty(nextToken));

        // Populate attributes (ARN, message counts, ...) with bounded parallelism.
        var throttle = new SemaphoreSlim(20);
        var tasks = result.Select(async item =>
        {
            await throttle.WaitAsync(ct);
            try
            {
                var attrs = await GetQueueAttributesAsync(client, item.Url, ct);
                item.Attributes = attrs;
                item.Arn = attrs.GetValueOrDefault("QueueArn");
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to fetch attributes for queue {Url}", item.Url);
            }
            finally
            {
                throttle.Release();
            }
        });

        await Task.WhenAll(tasks);
        return result;
    }

    public async Task<string> ResolveQueueUrlAsync(string queueName, CancellationToken ct)
    {
        var client = await GetClientAsync(ct);
        var resp = await client.GetQueueUrlAsync(new GetQueueUrlRequest { QueueName = queueName }, ct);
        return resp.QueueUrl;
    }

    public async Task<QueueItem> GetQueueDetailAsync(string queueName, CancellationToken ct)
    {
        var client = await GetClientAsync(ct);
        var url = await ResolveQueueUrlAsync(queueName, ct);
        var attrs = await GetQueueAttributesAsync(client, url, ct);
        return new QueueItem
        {
            Name = GetNameFromUrl(url),
            Url = url,
            Arn = attrs.GetValueOrDefault("QueueArn"),
            Attributes = attrs
        };
    }

    public async Task<string> CreateQueueAsync(CreateQueueRequestDto dto, CancellationToken ct)
    {
        var client = await GetClientAsync(ct);
        var name = dto.Name.Trim();

        if (string.IsNullOrWhiteSpace(name))
        {
            throw new ArgumentException("Queue name is required.");
        }

        if (dto.Fifo && !name.EndsWith(".fifo", StringComparison.OrdinalIgnoreCase))
        {
            throw new ArgumentException("FIFO queue names must end with the .fifo suffix.");
        }

        if (!dto.Fifo && name.EndsWith(".fifo", StringComparison.OrdinalIgnoreCase))
        {
            throw new ArgumentException("Standard queue names cannot end with the .fifo suffix. Enable FIFO to use this name.");
        }

        var attributes = new Dictionary<string, string>
        {
            ["VisibilityTimeout"] = (dto.VisibilityTimeout ?? 30).ToString(),
            ["MessageRetentionPeriod"] = (dto.MessageRetentionPeriod ?? 345600).ToString(),
            ["DelaySeconds"] = (dto.DelaySeconds ?? 0).ToString(),
            ["MaximumMessageSize"] = (dto.MaximumMessageSize ?? 262144).ToString(),
            ["ReceiveMessageWaitTimeSeconds"] = (dto.ReceiveMessageWaitTimeSeconds ?? 0).ToString()
        };

        if (dto.Fifo)
        {
            attributes["FifoQueue"] = "true";
            attributes["ContentBasedDeduplication"] = (dto.ContentBasedDeduplication ?? true) ? "true" : "false";
        }

        if (!string.IsNullOrWhiteSpace(dto.Policy))
        {
            attributes["Policy"] = dto.Policy;
        }

        if (!string.IsNullOrWhiteSpace(dto.RedrivePolicy))
        {
            attributes["RedrivePolicy"] = dto.RedrivePolicy;
        }

        var resp = await client.CreateQueueAsync(new CreateQueueRequest
        {
            QueueName = name,
            Attributes = attributes
        }, ct);

        return resp.QueueUrl;
    }

    public async Task DeleteQueueAsync(string queueUrl, CancellationToken ct)
    {
        var client = await GetClientAsync(ct);
        await client.DeleteQueueAsync(new DeleteQueueRequest { QueueUrl = queueUrl }, ct);
    }

    public async Task PurgeQueueAsync(string queueUrl, CancellationToken ct)
    {
        var client = await GetClientAsync(ct);
        await client.PurgeQueueAsync(new PurgeQueueRequest { QueueUrl = queueUrl }, ct);
    }

    // ------------------------------------------------------------- attributes

    private static async Task<Dictionary<string, string>> GetQueueAttributesAsync(
        AmazonSQSClient client, string queueUrl, CancellationToken ct)
    {
        var resp = await client.GetQueueAttributesAsync(new GetQueueAttributesRequest
        {
            QueueUrl = queueUrl,
            AttributeNames = new List<string> { "All" }
        }, ct);

        return resp.Attributes ?? new Dictionary<string, string>();
    }

    public async Task<Dictionary<string, string>> GetQueueAttributesAsync(string queueUrl, CancellationToken ct)
    {
        var client = await GetClientAsync(ct);
        return await GetQueueAttributesAsync(client, queueUrl, ct);
    }

    public async Task SetQueueAttributesAsync(SetQueueAttributesRequestDto dto, CancellationToken ct)
    {
        if (dto.Attributes.Count == 0)
        {
            throw new ArgumentException("At least one attribute must be provided.");
        }

        var client = await GetClientAsync(ct);
        await client.SetQueueAttributesAsync(new SetQueueAttributesRequest
        {
            QueueUrl = dto.QueueUrl,
            Attributes = dto.Attributes
        }, ct);
    }

    // --------------------------------------------------------------- messages

    public async Task<SendMessageResultDto> SendMessageAsync(SendMessageRequestDto dto, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(dto.Body))
        {
            throw new ArgumentException("Message body is required.");
        }

        var client = await GetClientAsync(ct);
        var req = new SendMessageRequest
        {
            QueueUrl = dto.QueueUrl,
            MessageBody = dto.Body
        };

        if (dto.DelaySeconds is not null)
        {
            req.DelaySeconds = dto.DelaySeconds.Value;
        }

        if (!string.IsNullOrEmpty(dto.MessageGroupId))
        {
            req.MessageGroupId = dto.MessageGroupId;
        }

        if (!string.IsNullOrEmpty(dto.MessageDeduplicationId))
        {
            req.MessageDeduplicationId = dto.MessageDeduplicationId;
        }

        if (dto.MessageAttributes is { Count: > 0 })
        {
            foreach (var (key, value) in dto.MessageAttributes)
            {
                req.MessageAttributes[key] = new MessageAttributeValue
                {
                    DataType = string.IsNullOrWhiteSpace(value.DataType) ? "String" : value.DataType,
                    StringValue = value.StringValue
                };
            }
        }

        var resp = await client.SendMessageAsync(req, ct);

        return new SendMessageResultDto
        {
            MessageId = resp.MessageId,
            MD5OfMessageBody = resp.MD5OfMessageBody,
            SequenceNumber = resp.SequenceNumber
        };
    }

    public async Task<List<ReceivedMessageDto>> ReceiveMessagesAsync(ReceiveMessagesRequestDto dto, CancellationToken ct)
    {
        var client = await GetClientAsync(ct);
        var resp = await client.ReceiveMessageAsync(new ReceiveMessageRequest
        {
            QueueUrl = dto.QueueUrl,
            MaxNumberOfMessages = Math.Clamp(dto.MaxNumberOfMessages, 1, 10),
            VisibilityTimeout = dto.VisibilityTimeout ?? 0,
            WaitTimeSeconds = dto.WaitTimeSeconds ?? 0,
            MessageSystemAttributeNames = new List<string> { "All" },
            MessageAttributeNames = new List<string> { "All" }
        }, ct);

        var messages = new List<ReceivedMessageDto>();
        foreach (var m in resp.Messages ?? new List<Message>())
        {
            var dto2 = new ReceivedMessageDto
            {
                MessageId = m.MessageId,
                Body = m.Body,
                ReceiptHandle = m.ReceiptHandle,
                MD5OfBody = m.MD5OfBody,
                Attributes = m.Attributes ?? new Dictionary<string, string>()
            };

            if (m.MessageAttributes is not null)
            {
                foreach (var (key, value) in m.MessageAttributes)
                {
                    dto2.MessageAttributes[key] = value.StringValue ?? $"<binary:{value.DataType}>";
                }
            }

            messages.Add(dto2);
        }

        return messages;
    }

    public async Task DeleteMessageAsync(DeleteMessageRequestDto dto, CancellationToken ct)
    {
        var client = await GetClientAsync(ct);
        await client.DeleteMessageAsync(new DeleteMessageRequest
        {
            QueueUrl = dto.QueueUrl,
            ReceiptHandle = dto.ReceiptHandle
        }, ct);
    }

    // ---------------------------------------------------------------- redrive

    private readonly ConcurrentDictionary<Guid, RedriveJob> _redriveJobs = new();

    /// <summary>
    /// A tracked redrive operation. Either wraps a managed AWS message move task
    /// (Mode = "managed") or a locally executed receive/send/delete loop
    /// (Mode = "manual") used when the endpoint does not implement the managed API.
    /// </summary>
    public sealed class RedriveJob
    {
        public Guid Id { get; init; } = Guid.NewGuid();
        public string Mode { get; set; } = "";
        public string SourceUrl { get; init; } = "";
        public string SourceArn { get; init; } = "";
        public string DestinationUrl { get; init; } = "";
        public string DestinationArn { get; init; } = "";
        public int MaxMessagesPerSecond { get; init; }
        public string? TaskHandle { get; set; }
        public CancellationTokenSource? Cts { get; set; }
        public DateTime StartedAt { get; init; } = DateTime.UtcNow;
        public DateTime? FinishedAt { get; private set; }

        public long Total { get; set; }
        public long Scanned { get; set; }
        public long Moved { get; set; }
        public long Failed { get; set; }
        public string Status { get; private set; } = "running";
        public string? Error { get; private set; }
        public int ConsecutiveFailures { get; set; }

        public void Finish(string status, string? error = null)
        {
            lock (this)
            {
                if (Status != "running") return;
                Status = status;
                Error = error;
                FinishedAt = DateTime.UtcNow;
            }
        }

        public void Fail(string error) => Finish("failed", error);

        /// <summary>Apply a status refresh coming from the managed message move task API.</summary>
        public void ApplyManagedUpdate(string status, string? error)
        {
            lock (this)
            {
                if (Status != "running") return; // keep the terminal state once reached
                Status = status;
                Error = error;
                if (status != "running") FinishedAt = DateTime.UtcNow;
            }
        }
    }

    /// <summary>
    /// Find queues that use the given queue as their dead-letter queue. Tries the
    /// managed ListDeadLetterSourceQueues API first and falls back to scanning
    /// every queue's RedrivePolicy for emulators that do not implement it.
    /// </summary>
    public async Task<List<QueueItem>> ListRedriveSourceQueuesAsync(string queueUrl, CancellationToken ct)
    {
        var client = await GetClientAsync(ct);
        var urls = new List<string>();

        try
        {
            var resp = await client.ListDeadLetterSourceQueuesAsync(new ListDeadLetterSourceQueuesRequest
            {
                QueueUrl = queueUrl
            }, ct);
            urls.AddRange(resp.QueueUrls ?? new List<string>());
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "ListDeadLetterSourceQueues unavailable ({Message}); scanning RedrivePolicies instead", ex.Message);
        }

        if (urls.Count == 0)
        {
            // Fallback: scan every queue's RedrivePolicy for a target matching this queue.
            var dlqArn = await ResolveArnAsync(client, queueUrl, ct);
            if (!string.IsNullOrEmpty(dlqArn))
            {
                var all = await ListQueuesAsync(null, ct);
                urls = all
                    .Where(q => ParseDeadLetterTargetArn(q.Attributes.GetValueOrDefault("RedrivePolicy")) == dlqArn)
                    .Select(q => q.Url)
                    .ToList();
            }
        }

        var result = new List<QueueItem>();
        foreach (var url in urls)
        {
            try
            {
                var attrs = await GetQueueAttributesAsync(client, url, ct);
                result.Add(new QueueItem
                {
                    Name = GetNameFromUrl(url),
                    Url = url,
                    Arn = attrs.GetValueOrDefault("QueueArn"),
                    Attributes = attrs
                });
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to load source queue {Url}", url);
            }
        }

        return result;
    }

    private async Task<string> ResolveArnAsync(AmazonSQSClient client, string queueUrl, CancellationToken ct)
    {
        var attrs = await GetQueueAttributesAsync(client, queueUrl, ct);
        return attrs.GetValueOrDefault("QueueArn") ?? "";
    }

    private static string? ParseDeadLetterTargetArn(string? policy)
    {
        if (string.IsNullOrWhiteSpace(policy)) return null;
        try
        {
            using var doc = JsonDocument.Parse(policy);
            return doc.RootElement.TryGetProperty("deadLetterTargetArn", out var p)
                ? p.GetString()
                : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    /// <summary>
    /// Start moving every message from the source queue to the destination queue.
    /// Prefers the managed message move task API and transparently falls back to a
    /// local receive/send/delete loop when the endpoint does not support it.
    /// </summary>
    public async Task<RedriveJobDto> StartRedriveAsync(StartRedriveRequestDto dto, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(dto.SourceQueueUrl))
        {
            throw new ArgumentException("Source queue URL is required.");
        }

        if (string.IsNullOrWhiteSpace(dto.DestinationQueueUrl))
        {
            throw new ArgumentException("A destination queue is required.");
        }

        if (string.Equals(dto.SourceQueueUrl, dto.DestinationQueueUrl, StringComparison.OrdinalIgnoreCase))
        {
            throw new ArgumentException("Source and destination queues must be different.");
        }

        if (dto.MaxMessagesPerSecond is < 0 or > 500)
        {
            throw new ArgumentException("Max messages per second must be between 0 (system optimized) and 500.");
        }

        PruneFinishedJobs();

        var client = await GetClientAsync(ct);
        var sourceArn = await ResolveArnAsync(client, dto.SourceQueueUrl, ct);
        var destinationArn = await ResolveArnAsync(client, dto.DestinationQueueUrl, ct);

        var job = new RedriveJob
        {
            SourceUrl = dto.SourceQueueUrl,
            SourceArn = sourceArn,
            DestinationUrl = dto.DestinationQueueUrl,
            DestinationArn = destinationArn,
            MaxMessagesPerSecond = dto.MaxMessagesPerSecond,
            Total = long.TryParse((await GetQueueAttributesAsync(client, dto.SourceQueueUrl, ct))
                .GetValueOrDefault("ApproximateNumberOfMessages"), out var n) ? n : 0
        };

        // Preferred path: the managed message move task API (real AWS + emulators that implement it).
        if (!string.IsNullOrEmpty(sourceArn) && !string.IsNullOrEmpty(destinationArn))
        {
            try
            {
                var req = new StartMessageMoveTaskRequest
                {
                    SourceArn = sourceArn,
                    DestinationArn = destinationArn
                };
                if (dto.MaxMessagesPerSecond > 0)
                {
                    req.MaxNumberOfMessagesPerSecond = dto.MaxMessagesPerSecond;
                }

                var resp = await client.StartMessageMoveTaskAsync(req, ct);
                job.Mode = "managed";
                job.TaskHandle = resp.TaskHandle;
                _redriveJobs[job.Id] = job;
                _logger.LogInformation("Started managed redrive task {TaskHandle} ({Source} -> {Destination})",
                    resp.TaskHandle, sourceArn, destinationArn);
                return new RedriveJobDto { JobId = job.Id, Mode = job.Mode, Total = job.Total };
            }
            catch (Exception ex) when (ex is AmazonSQSException or AmazonServiceException or HttpRequestException)
            {
                _logger.LogInformation(ex,
                    "Managed message move task unavailable ({Message}); falling back to manual redrive", ex.Message);
            }
        }

        // Fallback path: move messages locally with receive/send/delete + rate limiting.
        job.Mode = "manual";
        job.Cts = new CancellationTokenSource();
        _redriveJobs[job.Id] = job;
        _ = Task.Run(() => RunManualRedriveAsync(job, job.Cts.Token), CancellationToken.None);
        _logger.LogInformation("Started manual redrive job {JobId} ({Source} -> {Destination})",
            job.Id, dto.SourceQueueUrl, dto.DestinationQueueUrl);
        return new RedriveJobDto { JobId = job.Id, Mode = job.Mode, Total = job.Total };
    }

    public async Task<RedriveStatusDto> GetRedriveStatusAsync(Guid jobId, CancellationToken ct)
    {
        if (!_redriveJobs.TryGetValue(jobId, out var job))
        {
            throw new ArgumentException("Unknown redrive job.");
        }

        if (job.Mode == "manual")
        {
            return new RedriveStatusDto
            {
                JobId = job.Id,
                Mode = job.Mode,
                Status = job.Status,
                Moved = job.Moved,
                Total = job.Total,
                Failed = job.Failed,
                Error = job.Error,
                StartedAt = job.StartedAt,
                FinishedAt = job.FinishedAt
            };
        }

        // Refresh managed task progress from the endpoint.
        try
        {
            var client = await GetClientAsync(ct);
            var resp = await client.ListMessageMoveTasksAsync(new ListMessageMoveTasksRequest
            {
                SourceArn = job.SourceArn,
                MaxResults = 20
            }, ct);
            var task = resp.Results?.FirstOrDefault(t => t.TaskHandle == job.TaskHandle);
            if (task is not null)
            {
                job.ApplyManagedUpdate(task.Status switch
                {
                    "RUNNING" => "running",
                    "COMPLETED" => "completed",
                    "CANCELLED" => "stopped",
                    "FAILED" => "failed",
                    _ => "running"
                }, task.FailureReason);
                job.Moved = task.ApproximateNumberOfMessagesMoved ?? 0;
                if (task.ApproximateNumberOfMessagesToMove is > 0)
                {
                    job.Total = task.ApproximateNumberOfMessagesToMove.Value;
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to refresh managed redrive status for job {JobId}", job.Id);
        }

        return new RedriveStatusDto
        {
            JobId = job.Id,
            Mode = job.Mode,
            Status = job.Status,
            Moved = job.Moved,
            Total = job.Total,
            Failed = job.Failed,
            Error = job.Error,
            StartedAt = job.StartedAt,
            FinishedAt = job.FinishedAt
        };
    }

    public async Task StopRedriveAsync(Guid jobId, CancellationToken ct)
    {
        if (!_redriveJobs.TryGetValue(jobId, out var job))
        {
            throw new ArgumentException("Unknown redrive job.");
        }

        if (job.Mode == "manual")
        {
            job.Cts?.Cancel();
            return;
        }

        try
        {
            var client = await GetClientAsync(ct);
            await client.CancelMessageMoveTaskAsync(new CancelMessageMoveTaskRequest
            {
                TaskHandle = job.TaskHandle
            }, ct);
            _logger.LogInformation("Cancelled managed redrive task {TaskHandle}", job.TaskHandle);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to cancel managed redrive task {JobId}", job.Id);
        }
    }

    private void PruneFinishedJobs()
    {
        var cutoff = DateTime.UtcNow.AddHours(-1);
        foreach (var kv in _redriveJobs)
        {
            if (kv.Value.FinishedAt is { } finished && finished < cutoff)
            {
                _redriveJobs.TryRemove(kv.Key, out _);
            }
        }
    }

    private async Task RunManualRedriveAsync(RedriveJob job, CancellationToken ct)
    {
        try
        {
            var client = await GetClientAsync(ct);
            var destAttrs = await GetQueueAttributesAsync(client, job.DestinationUrl, ct);
            var destIsFifo = destAttrs.GetValueOrDefault("FifoQueue") == "true";
            var limiter = job.MaxMessagesPerSecond > 0 ? new MessageRateLimiter(job.MaxMessagesPerSecond) : null;

            while (!ct.IsCancellationRequested)
            {
                var resp = await client.ReceiveMessageAsync(new ReceiveMessageRequest
                {
                    QueueUrl = job.SourceUrl,
                    MaxNumberOfMessages = 10,
                    VisibilityTimeout = 30,
                    WaitTimeSeconds = 0,
                    MessageSystemAttributeNames = new List<string> { "All" },
                    MessageAttributeNames = new List<string> { "All" }
                }, ct);

                var messages = resp.Messages ?? new List<Message>();
                if (messages.Count == 0)
                {
                    job.Finish("completed");
                    return;
                }

                foreach (var message in messages)
                {
                    if (ct.IsCancellationRequested)
                    {
                        job.Finish("stopped");
                        return;
                    }

                    if (limiter is not null)
                    {
                        await limiter.WaitAsync(ct);
                    }

                    job.Scanned++;
                    try
                    {
                        await SendRedrivenMessageAsync(client, job.DestinationUrl, message, destIsFifo, ct);
                        await client.DeleteMessageAsync(new DeleteMessageRequest
                        {
                            QueueUrl = job.SourceUrl,
                            ReceiptHandle = message.ReceiptHandle
                        }, ct);
                        job.Moved++;
                        job.ConsecutiveFailures = 0;
                    }
                    catch (Exception ex) when (ex is not OperationCanceledException)
                    {
                        job.Failed++;
                        job.ConsecutiveFailures++;
                        _logger.LogWarning(ex, "Redrive: failed to move message {MessageId}", message.MessageId);
                        if (job.ConsecutiveFailures >= 25)
                        {
                            job.Fail("Too many consecutive messages failed to move; redrive aborted.");
                            return;
                        }
                    }
                }
            }

            job.Finish("stopped");
        }
        catch (OperationCanceledException)
        {
            job.Finish("stopped");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Redrive job {JobId} failed", job.Id);
            job.Fail(ex.Message);
        }
    }

    private static async Task SendRedrivenMessageAsync(
        AmazonSQSClient client, string destinationUrl, Message message, bool destIsFifo, CancellationToken ct)
    {
        var req = new SendMessageRequest
        {
            QueueUrl = destinationUrl,
            MessageBody = message.Body
        };

        if (message.MessageAttributes is { Count: > 0 })
        {
            foreach (var (key, value) in message.MessageAttributes)
            {
                req.MessageAttributes[key] = value;
            }
        }

        // Preserve FIFO ordering semantics: reuse the original group/dedup IDs when
        // the message has them, otherwise synthesize stable ones from the message ID.
        if (destIsFifo)
        {
            var groupId = message.Attributes.GetValueOrDefault("MessageGroupId");
            var dedupId = message.Attributes.GetValueOrDefault("MessageDeduplicationId");
            req.MessageGroupId = string.IsNullOrEmpty(groupId) ? "redrive" : groupId;
            req.MessageDeduplicationId = string.IsNullOrEmpty(dedupId) ? $"redrive-{message.MessageId}" : dedupId;
        }

        await client.SendMessageAsync(req, ct);
    }

    /// <summary>A simple token-bucket rate limiter for the manual redrive path.</summary>
    private sealed class MessageRateLimiter
    {
        private readonly int _maxPerSecond;
        private readonly object _lock = new();
        private double _tokens;
        private DateTime _lastRefill = DateTime.UtcNow;

        public MessageRateLimiter(int maxPerSecond)
        {
            _maxPerSecond = maxPerSecond;
            _tokens = maxPerSecond;
        }

        public async Task WaitAsync(CancellationToken ct)
        {
            while (true)
            {
                lock (_lock)
                {
                    var now = DateTime.UtcNow;
                    _tokens = Math.Min(_maxPerSecond, _tokens + (now - _lastRefill).TotalSeconds * _maxPerSecond);
                    _lastRefill = now;
                    if (_tokens >= 1)
                    {
                        _tokens -= 1;
                        return;
                    }
                }

                await Task.Delay(50, ct);
            }
        }
    }

    // ------------------------------------------------------------------- tags

    public async Task<Dictionary<string, string>> ListQueueTagsAsync(string queueUrl, CancellationToken ct)
    {
        var client = await GetClientAsync(ct);
        var resp = await client.ListQueueTagsAsync(new ListQueueTagsRequest { QueueUrl = queueUrl }, ct);
        return resp.Tags ?? new Dictionary<string, string>();
    }

    public async Task TagQueueAsync(TagQueueRequestDto dto, CancellationToken ct)
    {
        if (dto.Tags.Count == 0)
        {
            throw new ArgumentException("At least one tag must be provided.");
        }

        var client = await GetClientAsync(ct);
        await client.TagQueueAsync(new TagQueueRequest
        {
            QueueUrl = dto.QueueUrl,
            Tags = dto.Tags
        }, ct);
    }

    public async Task UntagQueueAsync(UntagQueueRequestDto dto, CancellationToken ct)
    {
        if (dto.TagKeys.Count == 0)
        {
            throw new ArgumentException("At least one tag key must be provided.");
        }

        var client = await GetClientAsync(ct);
        await client.UntagQueueAsync(new UntagQueueRequest
        {
            QueueUrl = dto.QueueUrl,
            TagKeys = dto.TagKeys
        }, ct);
    }

    // ------------------------------------------------------- connection test

    public async Task TestConnectionAsync(CancellationToken ct)
    {
        var client = await GetClientAsync(ct);
        await client.ListQueuesAsync(new ListQueuesRequest { MaxResults = 1 }, ct);
    }
}
