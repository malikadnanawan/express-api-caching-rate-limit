# README

## Overview

This is a simple Express.js API built with TypeScript.
The goal of this project is to demonstrate:

* An in-memory LRU cache with TTL
* Rate limiting
* Asynchronous request processing using a queue
* Concurrent request handling
* Basic user data API endpoints

This API serves mock user data and simulates real database latency.


## Features

1. Express.js server using TypeScript
2. LRU cache with:

   * 60-second TTL
   * Cache hits, misses, and size tracking
   * Automatic cleanup of expired entries
3. API endpoints:

   * GET /users/:id
   * POST /users
   * DELETE /cache
   * GET /cache-status
4. Rate limiting:

   * 10 requests per minute
   * Burst of 5 requests allowed in 10 seconds
5. Async database simulation using a simple queue
6. Concurrent request deduplication (only one fetch per ID)



## Installation

Clone the project and install dependencies:

```
git clone <repo-url>
cd <repo-folder>
npm install
```



## Running the Project

Development mode (runs TypeScript directly):

```
npm run dev
```

Build and production start:

```
npm run build
npm start
```

Server runs on:

```
http://localhost:3000
```



## API Endpoints

### GET /users/:id

Returns user data.
If cached: returns immediately.
If not cached: simulates a 200ms database fetch.

Example:

```
GET /users/1
```

### POST /users

Creates a new user and adds it to the mock database and cache.

Payload example:

```
{
  "id": 4,
  "name": "New User",
  "email": "test@example.com"
}
```

### DELETE /cache

Clears the entire cache.

### GET /cache-status

Returns cache hits, misses, size, and average response time.



## Mock User Data

The API uses simple hardcoded mock users:

```
1: { id: 1, name: "John Doe", email: "john@example.com" }
2: { id: 2, name: "Jane Smith", email: "jane@example.com" }
3: { id: 3, name: "Alice Johnson", email: "alice@example.com" }
```

---

## How It Works

### Caching

User data is stored in an LRU cache with a 60-second expiration.
Expired items are removed automatically.

### Rate Limiting

Each IP can make:

* 10 requests per minute
* Up to 5 quick requests in 10 seconds

Requests exceeding this return status 429.

### Async Processing

All database simulations run through a simple FIFO queue.
The simulated database call delays responses by 200ms.

### Concurrent Requests

If multiple requests for the same user ID arrive at the same time, the API only performs one database lookup.



## Testing

Use Postman, Thunder Client, or browser to test endpoints.

* First request to `/users/:id` should be slow (200ms)
* Second request should be fast (from cache)
* Sending many requests at once should trigger concurrency handling
* Exceeding limits should return HTTP 429

