using Amazon.SQS;
using SqsWorkbench.Api.Sqs;

var builder = WebApplication.CreateBuilder(args);

// Learn more about configuring OpenAPI at https://aka.ms/aspnet/openapi
builder.Services.AddOpenApi();
builder.Services.AddCors();
builder.Services.AddSingleton<SettingsStore>();
builder.Services.AddSingleton<SqsService>();

var app = builder.Build();

// Configure the HTTP request pipeline.
if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
    app.UseCors(policy => policy.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod());
}

app.Use(async (context, next) =>
{
    try
    {
        await next();
    }
    catch (Exception ex) when (context.Response.HasStarted == false)
    {
        var (status, code) = ex switch
        {
            AmazonSQSException sqs => (MapAwsStatus(sqs.StatusCode), sqs.ErrorCode ?? "AwsError"),
            Amazon.Runtime.AmazonServiceException => (502, "ConnectionFailed"),
            System.Net.Http.HttpRequestException => (502, "ConnectionFailed"),
            ArgumentException => (400, "BadRequest"),
            Microsoft.AspNetCore.Http.BadHttpRequestException => (400, "BadRequest"),
            _ => (500, "InternalServerError")
        };

        context.Response.StatusCode = status;
        await context.Response.WriteAsJsonAsync(new { error = code, message = ex.Message });
    }
});

// Map AWS HTTP status codes to friendlier client statuses.
static int MapAwsStatus(System.Net.HttpStatusCode status) => status switch
{
    System.Net.HttpStatusCode.BadRequest => 400,
    System.Net.HttpStatusCode.Forbidden => 403,
    System.Net.HttpStatusCode.NotFound => 404,
    _ => 502
};

// ------------------------------------------------------------- API endpoints

var api = app.MapGroup("/api");

// ---- settings -------------------------------------------------------------

api.MapGet("/settings", async (SettingsStore store) =>
{
    var s = await store.GetAsync();
    return Results.Ok(new SqsSettingsDto
    {
        Endpoint = s.Endpoint,
        Region = s.Region,
        AccessKey = s.AccessKey,
        HasSecretKey = !string.IsNullOrEmpty(s.SecretKey),
        SecretKeyMasked = string.IsNullOrEmpty(s.SecretKey) ? "" : "****"
    });
});

api.MapPut("/settings", async (SettingsStore store, UpdateSqsSettingsDto dto) =>
{
    var current = await store.GetAsync();

    var updated = new SqsSettings
    {
        Endpoint = string.IsNullOrWhiteSpace(dto.Endpoint) ? current.Endpoint : dto.Endpoint.Trim(),
        Region = string.IsNullOrWhiteSpace(dto.Region) ? current.Region : dto.Region.Trim(),
        AccessKey = string.IsNullOrWhiteSpace(dto.AccessKey) ? current.AccessKey : dto.AccessKey.Trim(),
        SecretKey = current.SecretKey
    };

    // Empty or masked secret means "keep the existing one".
    if (!string.IsNullOrWhiteSpace(dto.SecretKey) && dto.SecretKey != "****" && dto.SecretKey != current.SecretKey)
    {
        updated.SecretKey = dto.SecretKey;
    }

    await store.SaveAsync(updated);
    return Results.Ok(new { ok = true });
});

api.MapPost("/settings/test", async (SqsService sqs, CancellationToken ct) =>
{
    await sqs.TestConnectionAsync(ct);
    return Results.Ok(new { ok = true });
});

// ---- queues ---------------------------------------------------------------

api.MapGet("/queues", async (SqsService sqs, string? prefix, CancellationToken ct) =>
    Results.Ok(new { queues = await sqs.ListQueuesAsync(prefix, ct) }));

api.MapGet("/queues/url", async (SqsService sqs, string name, CancellationToken ct) =>
    Results.Ok(new { url = await sqs.ResolveQueueUrlAsync(name, ct) }));

api.MapGet("/queues/detail", async (SqsService sqs, string name, CancellationToken ct) =>
    Results.Ok(await sqs.GetQueueDetailAsync(name, ct)));

api.MapPost("/queues", async (SqsService sqs, CreateQueueRequestDto dto, CancellationToken ct) =>
{
    var url = await sqs.CreateQueueAsync(dto, ct);
    return Results.Created(url, new { url });
});

api.MapDelete("/queues", async (SqsService sqs, string url, CancellationToken ct) =>
{
    await sqs.DeleteQueueAsync(url, ct);
    return Results.NoContent();
});

api.MapPost("/queues/purge", async (SqsService sqs, QueueUrlRequestDto dto, CancellationToken ct) =>
{
    await sqs.PurgeQueueAsync(dto.QueueUrl, ct);
    return Results.Ok(new { ok = true });
});

// ---- attributes -----------------------------------------------------------

api.MapGet("/queues/attributes", async (SqsService sqs, string url, CancellationToken ct) =>
    Results.Ok(new { attributes = await sqs.GetQueueAttributesAsync(url, ct) }));

api.MapPut("/queues/attributes", async (SqsService sqs, SetQueueAttributesRequestDto dto, CancellationToken ct) =>
{
    await sqs.SetQueueAttributesAsync(dto, ct);
    return Results.Ok(new { ok = true });
});

// ---- messages -------------------------------------------------------------

api.MapPost("/queues/send-message", async (SqsService sqs, SendMessageRequestDto dto, CancellationToken ct) =>
    Results.Ok(await sqs.SendMessageAsync(dto, ct)));

api.MapPost("/queues/receive", async (SqsService sqs, ReceiveMessagesRequestDto dto, CancellationToken ct) =>
    Results.Ok(new { messages = await sqs.ReceiveMessagesAsync(dto, ct) }));

api.MapPost("/queues/delete-message", async (SqsService sqs, DeleteMessageRequestDto dto, CancellationToken ct) =>
{
    await sqs.DeleteMessageAsync(dto, ct);
    return Results.Ok(new { ok = true });
});

// ---- tags -----------------------------------------------------------------

api.MapGet("/queues/tags", async (SqsService sqs, string url, CancellationToken ct) =>
    Results.Ok(new { tags = await sqs.ListQueueTagsAsync(url, ct) }));

api.MapPut("/queues/tags", async (SqsService sqs, TagQueueRequestDto dto, CancellationToken ct) =>
{
    await sqs.TagQueueAsync(dto, ct);
    return Results.Ok(new { ok = true });
});

api.MapPost("/queues/untag", async (SqsService sqs, UntagQueueRequestDto dto, CancellationToken ct) =>
{
    await sqs.UntagQueueAsync(dto, ct);
    return Results.Ok(new { ok = true });
});

// ---- redrive --------------------------------------------------------------

api.MapGet("/queues/redrive/sources", async (SqsService sqs, string url, CancellationToken ct) =>
    Results.Ok(new { sources = await sqs.ListRedriveSourceQueuesAsync(url, ct) }));

api.MapPost("/queues/redrive", async (SqsService sqs, StartRedriveRequestDto dto, CancellationToken ct) =>
    Results.Ok(await sqs.StartRedriveAsync(dto, ct)));

api.MapGet("/queues/redrive/status", async (SqsService sqs, Guid jobId, CancellationToken ct) =>
    Results.Ok(await sqs.GetRedriveStatusAsync(jobId, ct)));

api.MapPost("/queues/redrive/stop", async (SqsService sqs, RedriveStopRequestDto dto, CancellationToken ct) =>
{
    await sqs.StopRedriveAsync(dto.JobId, ct);
    return Results.Ok(new { ok = true });
});

// ---- health ---------------------------------------------------------------

api.MapGet("/health", () => Results.Ok(new { status = "ok" }));

// ----------------------------------------------- SPA (static files in wwwroot)

app.UseDefaultFiles();
app.UseStaticFiles();

app.MapFallbackToFile("index.html");

app.Run();
