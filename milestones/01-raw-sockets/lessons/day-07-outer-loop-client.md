# Day 7 — The outer loop, and the client

## Theory

### The server, finally whole

Everything so far served one client and exited. The fix is one more loop, wrapped around
`accept()`:

```
socket() -> bind() -> listen()          once, at startup
    accept()                            per client
        recv()/send() until recv()==0   per exchange
    close(conn)                         per client
                                        then back to accept()
```

Note where `close()` is and is not. The connected socket dies with its client. The
listening socket outlives all of them — Day 4's factory-and-product rule, now load
bearing. Get it inverted and your server handles exactly one client, which is the exact
symptom the mistake produces.

This structure is also, precisely, why a blocking server can't serve two clients at once:
while you're inside the inner loop talking to client A, control is nowhere near
`accept()`. Client B's connection gets handshaken by the kernel and sits in the accept
queue from Day 3, waiting for you to come back around. It isn't refused, and it isn't
lost — it's just *ignored*, for as long as A holds you. Everything in milestone 02
exists to break that constraint.

### The client is the same API with one call swapped

```
socket()  ->  connect()  ->  send()/recv()  ->  close()
```

```cpp
int connect(int sockfd, const struct sockaddr *addr, socklen_t addrlen);
```

Identical in shape to `bind()` — same cast, same explicit length — but the address is
now the *destination* rather than the local endpoint:

```cpp
sockaddr_in server{};
server.sin_family = AF_INET;
server.sin_port = htons(9000);
inet_pton(AF_INET, "127.0.0.1", &server.sin_addr);
connect(fd, reinterpret_cast<sockaddr *>(&server), sizeof(server));
```

No `bind()`, no `listen()`, no `accept()`. Just `connect()`, which does three things
at once:

1. An **implicit bind**. Your client never picked a port, so the kernel assigns one from
   the ephemeral range (`/proc/sys/net/ipv4/ip_local_port_range`, usually 32768–60999).
   That's the `51234` you saw in the remote column on Day 4.
2. The **three-way handshake** — SYN, SYN-ACK, ACK — which is the part that blocks.
3. On success, the socket is `ESTABLISHED` and the very same `send()`/`recv()` you wrote
   for the server work here unchanged. There is no "client API"; a connected socket is a
   connected socket, and both ends are peers from here on.

`inet_pton()` is the modern counterpart to Day 4's `inet_ntop()` — text to binary rather
than binary to text:

```cpp
int inet_pton(int af, const char *restrict src, void *restrict dst);
```

It returns `1` on success, `0` if the string isn't a valid address in that family, and
`-1` on a bad family — so the usual `< 0` check silently accepts malformed input, and
you want `!= 1`.

Its failure modes are worth knowing by name, because each one tells you something
different:

- **`ECONNREFUSED`** — a machine is there and answered your SYN with an **RST**. Nothing
  is listening on that port. This comes back fast, which is the pleasant case: an
  immediate, unambiguous "no".
- **`ETIMEDOUT`** — no answer at all. Your SYNs vanished into the void: a firewall
  dropping packets silently, or a host that isn't there. This takes a long time to
  report, because the stack retries patiently before giving up.
- **`ENETUNREACH` / `EHOSTUNREACH`** — routing failed before anything left the building.

The gap between the first two is a genuinely useful diagnostic in production: *refused
fast* means the host is up and the service is down; *hangs then times out* usually means
a firewall.

### close() versus shutdown()

`close()` drops your process's reference to the socket. If that was the last reference,
the kernel begins tearing the connection down — both directions at once.

`shutdown()` is more precise, and it's the call people don't learn until they need it:

```cpp
int shutdown(int sockfd, int how);
```

```cpp
shutdown(fd, SHUT_WR);   // send FIN: "I'm done sending", still able to read
shutdown(fd, SHUT_RD);   // stop receiving
shutdown(fd, SHUT_RDWR); // both
```

`shutdown(fd, SHUT_WR)` performs a **half close**. It sends the FIN — so the peer's
`recv()` returns 0 and it knows your request is complete — while leaving your read side
open, so you can still receive their reply. That's the only correct way to say "that's
my whole request, now answer me" on a protocol without its own framing.

The classic bug it fixes: a client that sends a request, calls `close()`, and then tries
to read the response. The response never comes, because `close()` tore down both
directions and the server's reply hit a socket that no longer exists — it gets an RST for
its trouble. `shutdown(SHUT_WR)` then read, *then* `close()`, is the correct sequence.

There's also a refcount difference worth knowing: after `fork()`, two processes hold the
same socket, and `close()` in one only decrements the count — the connection stays up
until the last holder closes. `shutdown()` ignores refcounts entirely and acts on the
connection itself, affecting every process that shares it.

### The ephemeral port range, and why clients run out first

A client's four-tuple is (local IP, **ephemeral port**, server IP, server port). Three of
those are fixed when you connect to one service, so the only thing that varies is the
ephemeral port — roughly 28,000 of them by default. That's why the machine that exhausts
ports is almost always the *client* side of a busy service-to-service link, and why
`TIME_WAIT` on the client matters so much more than people expect: each closed connection
holds its ephemeral port for a minute or two, so a client opening thousands of short
connections per second can genuinely run out.

The fix isn't a bigger port range, it's connection reuse — which is why HTTP keep-alive
and connection pools exist at all.

## Task

Two programs. This is the day the pieces become the milestone's deliverable.

**`src/server.cpp`** — take Day 6 and wrap `accept()` in an outer loop:

1. `accept()`, serve the client with Day 6's echo loop, `close()` the connected socket,
   then loop back to `accept()`.
2. Print a line when each client connects and disconnects, with their address, so you can
   watch the cycle.
3. The server should never exit on its own. A client disconnecting is a normal event.

**`src/client.cpp`** — the mirror image:

1. `socket()`, then `connect()` to `127.0.0.1:9000` using `inet_pton()`.
2. Read lines from stdin. Send each one, `recv()` the echo, print it.
3. On EOF (Ctrl-D), `shutdown(fd, SHUT_WR)`, drain any remaining reply, then `close()`
   and exit cleanly.
4. Check every return value, including `connect()`.

Experiments:

**Prove the outer loop works.** Connect, disconnect, connect again, several times. The
server must survive every one. Then connect two clients at once and watch the second one
sit there getting nothing until the first disconnects — that's the accept queue holding
it, and it's the limitation milestone 02 removes.

**See ECONNREFUSED.** Run the client with no server running. Note how fast it fails,
and what `strerror(errno)` says.

**Watch your ephemeral port change.** Run the client several times, and each time have
the server print the client's port. It's different every run — that's the kernel's
implicit bind picking from the ephemeral range.

- Files: `src/server.cpp`, `src/client.cpp`
- Compile: `g++ -std=c++20 -Wall -Wextra -o server src/server.cpp && g++ -std=c++20 -Wall -Wextra -o client src/client.cpp`

### Checklist

- [ ] server survives a client disconnecting and accepts the next one
- [ ] connected socket closed per client; listening socket never closed in the loop
- [ ] client connects with `inet_pton()`, every return value checked
- [ ] client uses `shutdown(SHUT_WR)` on EOF and still reads the remaining reply
- [ ] observed a second client waiting in the accept queue while the first is served
- [ ] observed `ECONNREFUSED` and how quickly it returns
- [ ] zero warnings under `-Wall -Wextra` on both files

## Quiz

1. In the server's loop, which socket gets closed per client and which one must not?
   What's the symptom if you get it backwards?
2. Your blocking server is mid-conversation with client A when client B connects. What
   happens to B, and which mechanism from Day 3 is involved?
3. The client never calls `bind()`, yet it has a local port. Where did it come from, and
   what range does it come from?
4. A client sends a request, calls `close()`, then tries to `recv()` the response, and
   gets nothing. What's wrong, and which call fixes it?
5. `connect()` fails instantly with `ECONNREFUSED` on one host and hangs for a long time
   before `ETIMEDOUT` on another. What does each tell you about what's out there?
