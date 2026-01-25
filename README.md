# St. Matthew Religious Education Manager

This repository contains a .NET 8 minimal API backend and an Angular frontend for managing religious education registrations at St. Matthew Catholic Church.

## Server

```bash
dotnet run --project server/CCDClassManager.Api.csproj
```

The API is available at `http://localhost:5000` with endpoints under `/api`.

## Client

```bash
cd client
npm install
npm start
```

The Angular app expects the API to be running at `http://localhost:5000`.
