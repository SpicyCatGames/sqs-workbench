# ---------- Stage 1: build the React frontend ----------
FROM node:24-alpine AS frontend-build
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
# Output to a local dist folder instead of the default ../Api/wwwroot
ENV VITE_OUT_DIR=dist
RUN npm run build

# ---------- Stage 2: build the .NET API ----------
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS api-build
WORKDIR /src
COPY Api/ ./Api/
# Ship the freshly built SPA as static files served by the API (no node server)
COPY --from=frontend-build /src/frontend/dist ./Api/wwwroot
RUN dotnet publish Api/SqsWorkbench.Api.csproj -c Release -o /app/publish

# ---------- Stage 3: runtime ----------
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS final
WORKDIR /app
COPY --from=api-build /app/publish .
ENV ASPNETCORE_URLS=http://+:8080
ENV ASPNETCORE_ENVIRONMENT=Production
EXPOSE 8080
ENTRYPOINT ["dotnet", "SqsWorkbench.Api.dll"]
