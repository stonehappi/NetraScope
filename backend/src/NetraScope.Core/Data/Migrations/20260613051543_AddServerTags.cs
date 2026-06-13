using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace NetraScope.Core.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddServerTags : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "tags",
                columns: table => new
                {
                    Name = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_tags", x => x.Name);
                });

            migrationBuilder.CreateTable(
                name: "server_tags",
                columns: table => new
                {
                    ServerId = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    TagName = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_server_tags", x => new { x.ServerId, x.TagName });
                    table.ForeignKey(
                        name: "FK_server_tags_servers_ServerId",
                        column: x => x.ServerId,
                        principalTable: "servers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_server_tags_tags_TagName",
                        column: x => x.TagName,
                        principalTable: "tags",
                        principalColumn: "Name",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_server_tags_TagName",
                table: "server_tags",
                column: "TagName");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "server_tags");

            migrationBuilder.DropTable(
                name: "tags");
        }
    }
}
