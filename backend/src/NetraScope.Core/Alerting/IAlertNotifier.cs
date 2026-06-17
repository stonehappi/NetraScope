namespace NetraScope.Core.Alerting;

public interface IAlertNotifier
{
    Task NotifyAsync(AlertNotification notification, CancellationToken cancellationToken);
}
