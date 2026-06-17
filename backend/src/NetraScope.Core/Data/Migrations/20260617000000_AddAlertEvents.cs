using System;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace NetraScope.Core.Data.Migrations;

[DbContext(typeof(NetraDbContext))]
[Migration("20260617000000_AddAlertEvents")]
public partial class AddAlertEvents : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(
            name: "alert_events",
            columns: table => new
            {
                Id = table.Column<long>(type: "bigint", nullable: false)
                    .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                ServerId = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                OwnerUserId = table.Column<Guid>(type: "uuid", nullable: true),
                RuleKey = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                Severity = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                Status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                Message = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                TriggerValue = table.Column<double>(type: "double precision", nullable: true),
                ThresholdValue = table.Column<double>(type: "double precision", nullable: true),
                TriggeredAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                LastObservedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                ResolvedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                LastNotifiedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_alert_events", x => x.Id);
                table.ForeignKey(
                    name: "FK_alert_events_servers_ServerId",
                    column: x => x.ServerId,
                    principalTable: "servers",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Cascade);
            });

        migrationBuilder.CreateIndex(
            name: "IX_alert_events_LastObservedAt",
            table: "alert_events",
            column: "LastObservedAt");

        migrationBuilder.CreateIndex(
            name: "IX_alert_events_OwnerUserId",
            table: "alert_events",
            column: "OwnerUserId");

        migrationBuilder.CreateIndex(
            name: "IX_alert_events_ServerId_RuleKey_Status",
            table: "alert_events",
            columns: new[] { "ServerId", "RuleKey", "Status" });
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropTable(name: "alert_events");
    }
}
