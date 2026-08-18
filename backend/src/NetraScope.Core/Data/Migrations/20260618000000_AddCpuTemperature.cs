using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace NetraScope.Core.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddCpuTemperature : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<float>(
                name: "CpuTempC",
                table: "performance_metrics",
                type: "real",
                nullable: true);

            migrationBuilder.AddColumn<float>(
                name: "CpuTempAvgC",
                table: "metric_rollups",
                type: "real",
                nullable: true);

            migrationBuilder.AddColumn<float>(
                name: "CpuTempMaxC",
                table: "metric_rollups",
                type: "real",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "CpuTempC",
                table: "performance_metrics");

            migrationBuilder.DropColumn(
                name: "CpuTempAvgC",
                table: "metric_rollups");

            migrationBuilder.DropColumn(
                name: "CpuTempMaxC",
                table: "metric_rollups");
        }
    }
}
