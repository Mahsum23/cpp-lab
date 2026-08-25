# Milestone 01 — Raw Sockets

**Time budget:** 4–6 hours
**Prerequisites:** none
**Libraries allowed:** none. `<sys/socket.h>`, `<netinet/in.h>`, `<arpa/inet.h>`, `<unistd.h>` only.

## Why this exists

You already await async I/O at work. What you haven't done is see what's underneath it.
Asio will hide `accept()`, `recv()`, and the entire file-descriptor model behind
`async_read` and coroutine suspension. If you go straight to Asio, you'll be learning
the library and the operating system at the same time, and you'll end up trusting a
black box.

Build the black box first. Badly, blockingly, by hand. Then Asio becomes a convenience
rather than a mystery.

## Task

Write two programs:

### `src/server.cpp`
A TCP echo server. One client at a time is fine — in fact it's the point.

- Listens on port `9000`.
- Accepts a connection.
- Reads bytes from the client, writes the same bytes back.
- When the client disconnects, goes back to waiting for the next one. Does not exit.
- Prints the client's IP address on connect.

### `src/client.cpp`
- Connects to `127.0.0.1:9000`.
- Reads lines from stdin, sends each one, prints what comes back.
- Exits cleanly on EOF (Ctrl-D).

## Build

```
g++ -std=c++20 -Wall -Wextra -o server src/server.cpp
g++ -std=c++20 -Wall -Wextra -o client src/client.cpp
```

Fix every warning. `-Wall -Wextra` is not optional here.

## Constraints

- No `goto`-free-ing, no RAII wrappers, no abstraction layer. Write it flat and ugly.
  You are learning the syscall sequence, not designing a library. (You'll fix this in 02.)
- Check the return value of **every** syscall. All of them. `socket`, `bind`, `listen`,
  `accept`, `send`, `recv`, `close`. Print `strerror(errno)` on failure and exit.
  This is not busywork — half of what you're learning is how these fail.
- Handle the short-read/short-write problem. `recv()` returning 5 does not mean the
  client sent 5 bytes total. `send()` returning 5 does not mean it sent all your bytes.
  This is the single most common bug in hand-written socket code and you should hit it
  deliberately rather than accidentally later.

## Things that will bite you

Not hints — warnings, so you recognize them when they happen:

1. `accept()` returns a *different* socket than the one you called `listen()` on.
2. Restart the server too quickly after killing it and `bind()` fails with
   "Address already in use." There's a socket option that fixes this. Find it.
3. `recv()` returning `0` means orderly shutdown. `recv()` returning `-1` means error.
   These are different and you must handle both.
4. TCP is a byte stream, not a message stream. There are no "messages." If you assume
   one `send()` maps to one `recv()`, you will be wrong, and it will work fine in
   testing and break later.

## Stretch (only if the above is done and clean)

Make the server handle multiple clients by forking a process per connection. Do NOT use
threads yet — fork is simpler and the isolation makes the ownership question obvious.

## Done when

- [ ] Both programs compile with zero warnings under `-Wall -Wextra`
- [ ] Server survives a client disconnecting and accepts the next one
- [ ] Every syscall return value is checked
- [ ] Short reads/writes are handled correctly
- [ ] You can explain every line without looking it up

## Then

Post the code for review. After review passes, teach-back:
you'll explain the socket lifecycle and why `accept()` works the way it does,
in your own words, and I'll push on the gaps.
