/**
 * Atomic Lua scripts executed via Redis EVAL.
 *
 * All scripts return a four-element array:
 *   [allowed (1|0), remaining, resetAt (Unix seconds), limit]
 *
 * Using Lua guarantees atomicity — no race conditions under concurrent load.
 */

// ─── Fixed Window ────────────────────────────────────────────────────────────
// Single counter per time window.  Simple O(1) but has a boundary spike issue.
export const FIXED_WINDOW_SCRIPT = `
local key       = KEYS[1]
local limit     = tonumber(ARGV[1])
local windowMs  = tonumber(ARGV[2])
local now       = tonumber(ARGV[3])

local windowStart = math.floor(now / windowMs) * windowMs
local windowKey   = key .. ':fw:' .. windowStart

local count = tonumber(redis.call('INCR', windowKey))
if count == 1 then
    redis.call('PEXPIRE', windowKey, windowMs + 1000)
end

local resetAt = math.floor((windowStart + windowMs) / 1000)

if count > limit then
    return {0, 0, resetAt, limit}
end

return {1, limit - count, resetAt, limit}
`;

// ─── Sliding Window Counter ───────────────────────────────────────────────────
// Interpolates previous + current windows to smooth boundary spikes.
export const SLIDING_WINDOW_COUNTER_SCRIPT = `
local key      = KEYS[1]
local limit    = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local now      = tonumber(ARGV[3])

local currentWindowStart  = math.floor(now / windowMs) * windowMs
local previousWindowStart = currentWindowStart - windowMs

local currentKey  = key .. ':swc:curr:' .. currentWindowStart
local previousKey = key .. ':swc:prev:' .. previousWindowStart

local currentCount  = tonumber(redis.call('GET', currentKey))  or 0
local previousCount = tonumber(redis.call('GET', previousKey)) or 0

-- Weight of previous window based on how far we are into the current one
local elapsed       = (now - currentWindowStart) / windowMs
local weightedCount = previousCount * (1 - elapsed) + currentCount

local resetAt = math.floor((currentWindowStart + windowMs) / 1000)

if weightedCount >= limit then
    return {0, 0, resetAt, limit}
end

local newCount = tonumber(redis.call('INCR', currentKey))
if newCount == 1 then
    redis.call('PEXPIRE', currentKey, windowMs * 2 + 1000)
end

local remaining = math.max(0, limit - math.ceil(weightedCount) - 1)
return {1, remaining, resetAt, limit}
`;

// ─── Sliding Window Log ───────────────────────────────────────────────────────
// Stores each request timestamp in a sorted set.  Most accurate; O(log N).
export const SLIDING_WINDOW_LOG_SCRIPT = `
local key      = KEYS[1]
local limit    = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local now      = tonumber(ARGV[3])
local uniqueId = ARGV[4]

local windowStart = now - windowMs

-- Evict timestamps older than the sliding window
redis.call('ZREMRANGEBYSCORE', key, '-inf', windowStart)
local count = tonumber(redis.call('ZCARD', key))

local resetAt = math.floor((now + windowMs) / 1000)

if count >= limit then
    local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
    if #oldest > 0 then
        resetAt = math.floor((tonumber(oldest[2]) + windowMs) / 1000)
    end
    return {0, 0, resetAt, limit}
end

redis.call('ZADD', key, now, now .. ':' .. uniqueId)
redis.call('PEXPIRE', key, windowMs + 1000)

return {1, limit - count - 1, resetAt, limit}
`;

// ─── Token Bucket ─────────────────────────────────────────────────────────────
// Tokens refill continuously; bursting is allowed up to burstCapacity.
export const TOKEN_BUCKET_SCRIPT = `
local key             = KEYS[1]
local capacity        = tonumber(ARGV[1])
local refillRatePerMs = tonumber(ARGV[2])
local now             = tonumber(ARGV[3])
local requested       = tonumber(ARGV[4])

local data      = redis.call('HMGET', key, 'tokens', 'lastRefill')
local tokens    = tonumber(data[1])
local lastRefill = tonumber(data[2])

if tokens == nil then
    tokens     = capacity
    lastRefill = now
end

-- Refill tokens proportional to elapsed time
local elapsed    = math.max(0, now - lastRefill)
local refilled   = elapsed * refillRatePerMs
tokens           = math.min(capacity, tokens + refilled)
lastRefill       = now

local ttlMs = math.ceil(capacity / refillRatePerMs) + 5000

if tokens < requested then
    redis.call('HMSET', key, 'tokens', tokens, 'lastRefill', lastRefill)
    redis.call('PEXPIRE', key, ttlMs)
    local waitMs = math.ceil((requested - tokens) / refillRatePerMs)
    return {0, 0, math.floor((now + waitMs) / 1000), capacity}
end

tokens = tokens - requested
redis.call('HMSET', key, 'tokens', tokens, 'lastRefill', lastRefill)
redis.call('PEXPIRE', key, ttlMs)

local resetAt = math.floor(now / 1000) + math.ceil((capacity - tokens) / refillRatePerMs / 1000)
return {1, math.floor(tokens), resetAt, capacity}
`;
