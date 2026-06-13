using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace NetraScope.Core.Data.Migrations
{
    /// <inheritdoc />
    public partial class InitialCreate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "servers",
                columns: table => new
                {
                    Id = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    HostName = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    IpAddress = table.Column<string>(type: "character varying(45)", maxLength: 45, nullable: true),
                    LastHeartbeatAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_servers", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "performance_metrics",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    ServerId = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Timestamp = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CpuUsagePct = table.Column<float>(type: "real", nullable: false),
                    MemoryUsedBytes = table.Column<long>(type: "bigint", nullable: false),
                    MemoryTotalBytes = table.Column<long>(type: "bigint", nullable: false),
                    DiskUtilizationPct = table.Column<float>(type: "real", nullable: false),
                    NetworkInBytesSec = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_performance_metrics", x => x.Id);
                    table.ForeignKey(
                        name: "FK_performance_metrics_servers_ServerId",
                        column: x => x.ServerId,
                        principalTable: "servers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_performance_metrics_ServerId_Timestamp",
                table: "performance_metrics",
                columns: new[] { "ServerId", "Timestamp" },
                descending: new[] { false, true });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "performance_metrics");

            migrationBuilder.DropTable(
                name: "servers");
        }
    }
}
