using System.Text.Json;

namespace LocalSqsAdmin.Api.Sqs;

/// <summary>
/// Connection settings for the SQS endpoint the admin UI manages.
/// Defaults come from the SqsSettings section of appsettings.json and can be
/// overridden at runtime through the UI (persisted to App_Data/settings.json).
/// </summary>
public class SqsSettings
{
    public string Endpoint { get; set; } = "http://localhost:9324";
    public string Region { get; set; } = "us-east-1";
    public string AccessKey { get; set; } = "test";
    public string SecretKey { get; set; } = "test";
}

/// <summary>
/// The shape of the settings exposed/consumed by the API. The secret key is
/// masked when returned so it is never leaked to the browser.
/// </summary>
public class SqsSettingsDto
{
    public string Endpoint { get; set; } = "";
    public string Region { get; set; } = "";
    public string AccessKey { get; set; } = "";
    public bool HasSecretKey { get; set; }
    public string SecretKeyMasked { get; set; } = "****";
}

public class UpdateSqsSettingsDto
{
    public string? Endpoint { get; set; }
    public string? Region { get; set; }
    public string? AccessKey { get; set; }

    /// <summary>Empty or masked ("****") means "keep the existing value".</summary>
    public string? SecretKey { get; set; }
}

public class SettingsStore
{
    private static readonly JsonSerializerOptions JsonOpts = new() { WriteIndented = true };

    private readonly IConfiguration _config;
    private readonly IWebHostEnvironment _env;
    private readonly ILogger<SettingsStore> _logger;
    private readonly SemaphoreSlim _lock = new(1, 1);
    private readonly string _filePath;

    private SqsSettings? _cached;

    public SettingsStore(IConfiguration config, IWebHostEnvironment env, ILogger<SettingsStore> logger)
    {
        _config = config;
        _env = env;
        _logger = logger;
        _filePath = Path.Combine(env.ContentRootPath, "App_Data", "settings.json");
    }

    public async Task<SqsSettings> GetAsync()
    {
        await _lock.WaitAsync();
        try
        {
            if (_cached is null)
            {
                // Resolution order (first wins): UI-saved file > AWS_* env vars > appsettings.json
                var settings = new SqsSettings();
                _config.GetSection("SqsSettings").Bind(settings);

                ApplyEnvOverrides(settings);

                if (File.Exists(_filePath))
                {
                    try
                    {
                        var saved = JsonSerializer.Deserialize<SqsSettings>(await File.ReadAllTextAsync(_filePath));
                        if (saved is not null)
                        {
                            settings = saved;
                            _logger.LogInformation("Loaded saved SQS settings from {Path}", _filePath);
                        }
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning(ex, "Failed to read saved settings file {Path}; using defaults", _filePath);
                    }
                }

                _cached = settings;
            }

            return _cached;
        }
        finally
        {
            _lock.Release();
        }
    }

    private void ApplyEnvOverrides(SqsSettings settings)
    {
        var endpoint = Environment.GetEnvironmentVariable("AWS_ENDPOINT_URL");
        if (!string.IsNullOrWhiteSpace(endpoint))
        {
            settings.Endpoint = endpoint.Trim();
        }

        var region = Environment.GetEnvironmentVariable("AWS_DEFAULT_REGION")
                     ?? Environment.GetEnvironmentVariable("AWS_REGION");
        if (!string.IsNullOrWhiteSpace(region))
        {
            settings.Region = region.Trim();
        }

        var accessKey = Environment.GetEnvironmentVariable("AWS_ACCESS_KEY_ID");
        if (!string.IsNullOrWhiteSpace(accessKey))
        {
            settings.AccessKey = accessKey;
        }

        var secretKey = Environment.GetEnvironmentVariable("AWS_SECRET_ACCESS_KEY");
        if (!string.IsNullOrWhiteSpace(secretKey))
        {
            settings.SecretKey = secretKey;
        }
    }

    public async Task SaveAsync(SqsSettings settings)
    {
        await _lock.WaitAsync();
        try
        {
            _cached = settings;
            var dir = Path.GetDirectoryName(_filePath);
            if (!string.IsNullOrEmpty(dir))
            {
                Directory.CreateDirectory(dir);
            }

            await File.WriteAllTextAsync(_filePath, JsonSerializer.Serialize(settings, JsonOpts));
            _logger.LogInformation("Saved SQS settings to {Path}", _filePath);
        }
        finally
        {
            _lock.Release();
        }
    }
}
