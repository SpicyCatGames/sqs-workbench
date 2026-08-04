using Amazon;
using Amazon.Runtime;
using Amazon.SQS;
using Amazon.SQS.Model;

namespace LocalSqsAdmin.Api.Sqs;

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
