using Microsoft.EntityFrameworkCore;
using NetraScope.Core.Entities;

namespace NetraScope.Core.Data;

public sealed class NetraDbContext(DbContextOptions<NetraDbContext> options)
    : DbContext(options)
{
    public DbSet<Server> Servers => Set<Server>();

    public DbSet<PerformanceMetric> PerformanceMetrics => Set<PerformanceMetric>();

    public DbSet<Tag> Tags => Set<Tag>();

    public DbSet<ServerTag> ServerTags => Set<ServerTag>();

    public DbSet<User> Users => Set<User>();

    public DbSet<AlertEvent> AlertEvents => Set<AlertEvent>();

    public DbSet<AgentToken> AgentTokens => Set<AgentToken>();

    public DbSet<AuditLog> AuditLogs => Set<AuditLog>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Server>(entity =>
        {
            entity.ToTable("servers");
            entity.HasKey(server => server.Id);
            entity.Property(server => server.Id).HasMaxLength(200);
            entity.Property(server => server.HostName).HasMaxLength(255).IsRequired();
            entity.Property(server => server.IpAddress).HasMaxLength(45);
            entity.Property(server => server.LastHeartbeatAt).IsRequired();

            entity
                .HasOne(server => server.Owner)
                .WithMany()
                .HasForeignKey(server => server.OwnerUserId)
                .OnDelete(DeleteBehavior.SetNull);

            entity.HasIndex(server => server.OwnerUserId);
        });

        modelBuilder.Entity<PerformanceMetric>(entity =>
        {
            entity.ToTable("performance_metrics");
            entity.HasKey(metric => metric.Id);
            entity.Property(metric => metric.Id).UseIdentityByDefaultColumn();
            entity.Property(metric => metric.ServerId).HasMaxLength(200).IsRequired();
            entity.Property(metric => metric.Timestamp).IsRequired();

            entity
                .HasIndex(metric => new { metric.ServerId, metric.Timestamp })
                .IsDescending(false, true);

            entity
                .HasOne(metric => metric.Server)
                .WithMany(server => server.Metrics)
                .HasForeignKey(metric => metric.ServerId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<Tag>(entity =>
        {
            entity.ToTable("tags");
            entity.HasKey(tag => tag.Name);
            entity.Property(tag => tag.Name).HasMaxLength(50);
        });

        modelBuilder.Entity<ServerTag>(entity =>
        {
            entity.ToTable("server_tags");
            entity.HasKey(serverTag => new { serverTag.ServerId, serverTag.TagName });
            entity.Property(serverTag => serverTag.ServerId).HasMaxLength(200);
            entity.Property(serverTag => serverTag.TagName).HasMaxLength(50);

            entity
                .HasOne(serverTag => serverTag.Server)
                .WithMany(server => server.ServerTags)
                .HasForeignKey(serverTag => serverTag.ServerId)
                .OnDelete(DeleteBehavior.Cascade);

            entity
                .HasOne(serverTag => serverTag.Tag)
                .WithMany(tag => tag.ServerTags)
                .HasForeignKey(serverTag => serverTag.TagName)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasIndex(serverTag => serverTag.TagName);
        });

        modelBuilder.Entity<User>(entity =>
        {
            entity.ToTable("users");
            entity.HasKey(user => user.Id);
            entity.Property(user => user.Username).HasMaxLength(100).IsRequired();
            entity.Property(user => user.PasswordHash).IsRequired();
            entity.Property(user => user.IngestionToken).HasMaxLength(64).IsRequired();
            entity.Property(user => user.CreatedAt).IsRequired();

            entity.HasIndex(user => user.Username).IsUnique();
            entity.HasIndex(user => user.IngestionToken).IsUnique();
        });

        modelBuilder.Entity<AlertEvent>(entity =>
        {
            entity.ToTable("alert_events");
            entity.HasKey(alert => alert.Id);
            entity.Property(alert => alert.Id).UseIdentityByDefaultColumn();
            entity.Property(alert => alert.ServerId).HasMaxLength(200).IsRequired();
            entity.Property(alert => alert.RuleKey).HasMaxLength(100).IsRequired();
            entity.Property(alert => alert.Severity).HasMaxLength(20).IsRequired();
            entity.Property(alert => alert.Status).HasMaxLength(20).IsRequired();
            entity.Property(alert => alert.Message).HasMaxLength(500).IsRequired();
            entity.Property(alert => alert.TriggeredAt).IsRequired();
            entity.Property(alert => alert.LastObservedAt).IsRequired();

            entity.HasIndex(alert => alert.OwnerUserId);
            entity.HasIndex(alert => new { alert.ServerId, alert.RuleKey, alert.Status });
            entity.HasIndex(alert => alert.LastObservedAt);

            entity
                .HasOne(alert => alert.Server)
                .WithMany(server => server.AlertEvents)
                .HasForeignKey(alert => alert.ServerId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<AgentToken>(entity =>
        {
            entity.ToTable("agent_tokens");
            entity.HasKey(token => token.Id);
            entity.Property(token => token.ServerId).HasMaxLength(200).IsRequired();
            entity.Property(token => token.Name).HasMaxLength(100).IsRequired();
            entity.Property(token => token.TokenHash).HasMaxLength(64).IsRequired();
            entity.Property(token => token.TokenSuffix).HasMaxLength(16).IsRequired();
            entity.Property(token => token.AllowedIpAddresses).HasMaxLength(1000);
            entity.Property(token => token.CreatedAt).IsRequired();

            entity.HasIndex(token => token.TokenHash).IsUnique();
            entity.HasIndex(token => new { token.ServerId, token.OwnerUserId });

            entity
                .HasOne(token => token.Server)
                .WithMany(server => server.AgentTokens)
                .HasForeignKey(token => token.ServerId)
                .OnDelete(DeleteBehavior.Cascade);

            entity
                .HasOne(token => token.Owner)
                .WithMany()
                .HasForeignKey(token => token.OwnerUserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<AuditLog>(entity =>
        {
            entity.ToTable("audit_logs");
            entity.HasKey(log => log.Id);
            entity.Property(log => log.Id).UseIdentityByDefaultColumn();
            entity.Property(log => log.ActorType).HasMaxLength(50).IsRequired();
            entity.Property(log => log.Action).HasMaxLength(100).IsRequired();
            entity.Property(log => log.EntityType).HasMaxLength(100).IsRequired();
            entity.Property(log => log.EntityId).HasMaxLength(200);
            entity.Property(log => log.Message).HasMaxLength(500);
            entity.Property(log => log.IpAddress).HasMaxLength(45);
            entity.Property(log => log.CreatedAt).IsRequired();

            entity.HasIndex(log => new { log.OwnerUserId, log.CreatedAt });
        });
    }
}
