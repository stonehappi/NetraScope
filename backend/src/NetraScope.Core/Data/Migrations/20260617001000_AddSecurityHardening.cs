using System;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace NetraScope.Core.Data.Migrations;

[DbContext(typeof(NetraDbContext))]
[Migration("20260617001000_AddSecurityHardening")]
public partial class AddSecurityHardening : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(
            name: "agent_tokens",
            columns: table => new
            {
                Id = table.Column<Guid>(type: "uuid", nullable: false),
                ServerId = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                OwnerUserId = table.Column<Guid>(type: "uuid", nullable: false),
                Name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                TokenHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                TokenSuffix = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                AllowedIpAddresses = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                LastUsedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                RevokedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_agent_tokens", x => x.Id);
                table.ForeignKey(
                    name: "FK_agent_tokens_servers_ServerId",
                    column: x => x.ServerId,
                    principalTable: "servers",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Cascade);
                table.ForeignKey(
                    name: "FK_agent_tokens_users_OwnerUserId",
                    column: x => x.OwnerUserId,
                    principalTable: "users",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Cascade);
            });

        migrationBuilder.CreateTable(
            name: "audit_logs",
            columns: table => new
            {
                Id = table.Column<long>(type: "bigint", nullable: false)
                    .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                OwnerUserId = table.Column<Guid>(type: "uuid", nullable: true),
                ActorType = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                Action = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                EntityType = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                EntityId = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                Message = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                IpAddress = table.Column<string>(type: "character varying(45)", maxLength: 45, nullable: true),
                CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_audit_logs", x => x.Id);
            });

        migrationBuilder.CreateIndex(
            name: "IX_agent_tokens_ServerId_OwnerUserId",
            table: "agent_tokens",
            columns: new[] { "ServerId", "OwnerUserId" });

        migrationBuilder.CreateIndex(
            name: "IX_agent_tokens_TokenHash",
            table: "agent_tokens",
            column: "TokenHash",
            unique: true);

        migrationBuilder.CreateIndex(
            name: "IX_agent_tokens_OwnerUserId",
            table: "agent_tokens",
            column: "OwnerUserId");

        migrationBuilder.CreateIndex(
            name: "IX_audit_logs_OwnerUserId_CreatedAt",
            table: "audit_logs",
            columns: new[] { "OwnerUserId", "CreatedAt" });
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropTable(name: "agent_tokens");
        migrationBuilder.DropTable(name: "audit_logs");
    }
}
