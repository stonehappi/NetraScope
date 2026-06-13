# syntax=docker/dockerfile:1
#
# Build context must be the repository root, e.g.:
#   docker build -f backend/Dockerfile -t netrascope-backend .

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

COPY Directory.Build.props ./
COPY backend/src/NetraScope.Shared/NetraScope.Shared.csproj backend/src/NetraScope.Shared/
COPY backend/src/NetraScope.Core/NetraScope.Core.csproj backend/src/NetraScope.Core/
RUN dotnet restore backend/src/NetraScope.Core/NetraScope.Core.csproj

COPY backend/src/ backend/src/
RUN dotnet publish backend/src/NetraScope.Core/NetraScope.Core.csproj \
    -c Release -o /app/publish --no-restore

# Applies EF Core migrations against ConnectionStrings__NetraScope.
FROM build AS migrations
WORKDIR /src
COPY .config/dotnet-tools.json .config/dotnet-tools.json
RUN dotnet tool restore
ENTRYPOINT ["dotnet", "ef", "database", "update", \
    "--project", "backend/src/NetraScope.Core", \
    "--startup-project", "backend/src/NetraScope.Core"]

# Runtime image for the API.
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS final
WORKDIR /app
COPY --from=build /app/publish .
EXPOSE 8080
ENTRYPOINT ["dotnet", "NetraScope.Core.dll"]
