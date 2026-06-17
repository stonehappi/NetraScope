using System.Net.Http.Json;
using Microsoft.Extensions.Options;

namespace NetraScope.Core.Alerting;

public sealed class WebhookAlertNotifier(
    HttpClient httpClient,
    IOptions<AlertingOptions> options,
    ILogger<WebhookAlertNotifier> logger) : IAlertNotifier
{
    public async Task NotifyAsync(
        AlertNotification notification,
        CancellationToken cancellationToken)
    {
        var targetCount = 0;
        foreach (var url in options.Value.WebhookUrls.Where(IsConfigured))
        {
            targetCount++;
            await PostJsonAsync(url, notification, cancellationToken);
        }

        if (IsConfigured(options.Value.EmailWebhookUrl))
        {
            targetCount++;
            await PostJsonAsync(options.Value.EmailWebhookUrl!, notification, cancellationToken);
        }

        if (IsConfigured(options.Value.DiscordWebhookUrl))
        {
            targetCount++;
            await PostJsonAsync(
                options.Value.DiscordWebhookUrl!,
                new
                {
                    content = FormatText(notification),
                },
                cancellationToken);
        }

        if (IsConfigured(options.Value.SlackWebhookUrl))
        {
            targetCount++;
            await PostJsonAsync(
                options.Value.SlackWebhookUrl!,
                new
                {
                    text = FormatText(notification),
                },
                cancellationToken);
        }

        if (IsConfigured(options.Value.TelegramBotToken) &&
            IsConfigured(options.Value.TelegramChatId))
        {
            targetCount++;
            var telegramUrl =
                $"https://api.telegram.org/bot{options.Value.TelegramBotToken}/sendMessage";
            await PostJsonAsync(
                telegramUrl,
                new
                {
                    chat_id = options.Value.TelegramChatId,
                    text = FormatText(notification),
                },
                cancellationToken);
        }

        if (targetCount == 0)
        {
            logger.LogInformation(
                "Alert {AlertId} changed to {Status}: {Message}",
                notification.AlertId,
                notification.Status,
                notification.Message);
        }
    }

    private async Task PostJsonAsync<T>(
        string url,
        T payload,
        CancellationToken cancellationToken)
    {
        try
        {
            using var response = await httpClient.PostAsJsonAsync(url, payload, cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                logger.LogWarning(
                    "Alert notification target {Url} returned {StatusCode}",
                    url,
                    response.StatusCode);
            }
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            logger.LogWarning(ex, "Alert notification target {Url} failed", url);
        }
    }

    private static string FormatText(AlertNotification notification) =>
        $"NetraScope {notification.Status.ToUpperInvariant()} {notification.RuleKey} " +
        $"for {notification.ServerId}: {notification.Message}";

    private static bool IsConfigured(string? value) =>
        !string.IsNullOrWhiteSpace(value);
}
