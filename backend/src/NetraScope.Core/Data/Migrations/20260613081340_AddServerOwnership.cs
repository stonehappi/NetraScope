using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace NetraScope.Core.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddServerOwnership : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "IngestionToken",
                table: "users",
                type: "character varying(64)",
                maxLength: 64,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<Guid>(
                name: "OwnerUserId",
                table: "servers",
                type: "uuid",
                nullable: true);

            migrationBuilder.Sql(
                """
                UPDATE users SET "IngestionToken" = md5(random()::text || "Id"::text)
                """);

            migrationBuilder.CreateIndex(
                name: "IX_users_IngestionToken",
                table: "users",
                column: "IngestionToken",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_servers_OwnerUserId",
                table: "servers",
                column: "OwnerUserId");

            migrationBuilder.AddForeignKey(
                name: "FK_servers_users_OwnerUserId",
                table: "servers",
                column: "OwnerUserId",
                principalTable: "users",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_servers_users_OwnerUserId",
                table: "servers");

            migrationBuilder.DropIndex(
                name: "IX_users_IngestionToken",
                table: "users");

            migrationBuilder.DropIndex(
                name: "IX_servers_OwnerUserId",
                table: "servers");

            migrationBuilder.DropColumn(
                name: "IngestionToken",
                table: "users");

            migrationBuilder.DropColumn(
                name: "OwnerUserId",
                table: "servers");
        }
    }
}
