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
    }
}
