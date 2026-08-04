namespace LocalSqsAdmin.Api.Sqs;

/// <summary>A single SQS queue as shown in the list view.</summary>
public class QueueItem
{
    public string Name { get; set; } = "";
    public string Url { get; set; } = "";
    public string? Arn { get; set; }
    public Dictionary<string, string> Attributes { get; set; } = new();
}

/// <summary>Request body for creating a queue.</summary>
public class CreateQueueRequestDto
{
    public string Name { get; set; } = "";
    public bool Fifo { get; set; }
    public int? VisibilityTimeout { get; set; }
    public int? MessageRetentionPeriod { get; set; }
    public int? DelaySeconds { get; set; }
    public int? MaximumMessageSize { get; set; }
    public int? ReceiveMessageWaitTimeSeconds { get; set; }
    public bool? ContentBasedDeduplication { get; set; }
    public string? Policy { get; set; }
    public string? RedrivePolicy { get; set; }
}

/// <summary>A message attribute value (string-typed).</summary>
public class MessageAttributeDto
{
    public string DataType { get; set; } = "String";
    public string? StringValue { get; set; }
}

/// <summary>Request body for sending a message.</summary>
public class SendMessageRequestDto
{
    public string QueueUrl { get; set; } = "";
    public string Body { get; set; } = "";
    public int? DelaySeconds { get; set; }
    public Dictionary<string, MessageAttributeDto>? MessageAttributes { get; set; }
    public string? MessageGroupId { get; set; }
    public string? MessageDeduplicationId { get; set; }
}

/// <summary>Result of a successful send.</summary>
public class SendMessageResultDto
{
    public string MessageId { get; set; } = "";
    public string? MD5OfMessageBody { get; set; }
    public string? SequenceNumber { get; set; }
}

/// <summary>A received message.</summary>
public class ReceivedMessageDto
{
    public string MessageId { get; set; } = "";
    public string Body { get; set; } = "";
    public string ReceiptHandle { get; set; } = "";
    public string? MD5OfBody { get; set; }
    public Dictionary<string, string> Attributes { get; set; } = new();
    public Dictionary<string, string> MessageAttributes { get; set; } = new();
}

/// <summary>Request body for receiving messages.</summary>
public class ReceiveMessagesRequestDto
{
    public string QueueUrl { get; set; } = "";
    public int MaxNumberOfMessages { get; set; } = 10;
    public int? VisibilityTimeout { get; set; }
    public int? WaitTimeSeconds { get; set; }
}

/// <summary>Request body for deleting a message by receipt handle.</summary>
public class DeleteMessageRequestDto
{
    public string QueueUrl { get; set; } = "";
    public string ReceiptHandle { get; set; } = "";
}

/// <summary>Request body for purge / delete queue (URL only).</summary>
public class QueueUrlRequestDto
{
    public string QueueUrl { get; set; } = "";
}

/// <summary>Request body for setting queue attributes.</summary>
public class SetQueueAttributesRequestDto
{
    public string QueueUrl { get; set; } = "";
    public Dictionary<string, string> Attributes { get; set; } = new();
}

/// <summary>Request body for tagging a queue.</summary>
public class TagQueueRequestDto
{
    public string QueueUrl { get; set; } = "";
    public Dictionary<string, string> Tags { get; set; } = new();
}

/// <summary>Request body for untagging a queue.</summary>
public class UntagQueueRequestDto
{
    public string QueueUrl { get; set; } = "";
    public List<string> TagKeys { get; set; } = new();
}
