using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace NetraScope.Core.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddMetricRollups : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "metric_rollups",
                columns: table => new
                {
                    Granularity = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    ServerId = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    BucketStart = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CpuAvgPct = table.Column<float>(type: "real", nullable: false),
                    CpuMaxPct = table.Column<float>(type: "real", nullable: false),
                    MemoryUsedAvgBytes = table.Column<long>(type: "bigint", nullable: false),
                    MemoryUsedMaxBytes = table.Column<long>(type: "bigint", nullable: false),
                    MemoryTotalMaxBytes = table.Column<long>(type: "bigint", nullable: false),
                    DiskAvgPct = table.Column<float>(type: "real", nullable: false),
                    DiskMaxPct = table.Column<float>(type: "real", nullable: false),
                    NetworkInAvgBytesSec = table.Column<long>(type: "bigint", nullable: false),
                    NetworkInMaxBytesSec = table.Column<long>(type: "bigint", nullable: false),
                    SampleCount = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_metric_rollups", x => new { x.ServerId, x.Granularity, x.BucketStart });
                    table.ForeignKey(
                        name: "FK_metric_rollups_servers_ServerId",
                        column: x => x.ServerId,
                        principalTable: "servers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_metric_rollups_Granularity_BucketStart",
                table: "metric_rollups",
                columns: new[] { "Granularity", "BucketStart" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "metric_rollups");
        }
    }
}
