# Day 2 — Addresses and byte order

## Theory

### `sockaddr_in`: the address socket() was missing

Day 1 left the fd with no address — the kernel had a TCP socket in state `CLOSED`,
allocated but unconfigured. `bind()`, three days from now, needs an address to give it,
and that address is a struct:

```cpp
struct sockaddr_in {
    sa_family_t    sin_family;   // AF_INET
    in_port_t      sin_port;     // port, in network byte order
    struct in_addr sin_addr;     // IPv4 address, in network byte order
    unsigned char  sin_zero[8];  // padding — see below
};
```

Four fields, and every one of them is trying to solve a different problem.

### Why `sin_zero` is there at all

`bind()`, `connect()`, and `accept()` don't take a `sockaddr_in *`. They take a
`sockaddr *` — a *generic* address struct that's supposed to work for `AF_INET`,
`AF_INET6`, `AF_UNIX`, and anything else anyone invents later. C has no inheritance, so
in 1983 the answer was: make every address-family-specific struct exactly the same
*size* as the generic one, and let callers cast between the pointer types. `sin_zero`
is filler that exists purely to pad `sockaddr_in` out to match `sizeof(struct
sockaddr)` — it carries no data and you never read it. It's the C-shaped version of a
base class, four decades before anyone would call it that.

(`sockaddr_in6`, for IPv6, is a different size again — which is exactly why every one
of these calls also takes an explicit length parameter alongside the pointer. The
struct can't tell you its own size once it's been cast to the generic type.)

### Byte order: the actual problem being solved

`sin_port` and `sin_addr` are multi-byte integers, and a multi-byte integer has no
single obvious way to sit in memory. Take the port `9000`, decimal — in hex that's
`0x2328`. A CPU has to decide which byte goes at the lower address: the `0x23` or the
`0x28`. Intel chips (and ARM, in its usual mode) put the *least* significant byte
first — **little-endian**. Older Motorola and SPARC chips did the opposite —
**big-endian**. Neither is "correct"; they're just two equally valid conventions that
different hardware vendors picked independently.

That's fine as long as a number never leaves the machine that produced it. The moment
two different computers need to agree on what bytes on the wire *mean*, they need to
agree on an order — otherwise a little-endian machine sends `9000` and a big-endian
machine reads it back as `9217`. The internet's answer, baked into TCP/IP from the
start, is: **network byte order is always big-endian**, full stop, regardless of what
either endpoint's CPU prefers internally. `htons()` (host-to-network-short, for 16-bit
values like ports) and `htonl()` (host-to-network-long, for 32-bit values like
addresses) convert *your* machine's native order into that fixed wire order. Their
inverses, `ntohs()`/`ntohl()`, undo it on the way back in.

Here's the detail that trips people up the first time: on a big-endian machine,
`htons()` has nothing to do — the native order and the network order are already the
same — so it's typically defined to literally return its argument unchanged. It still
compiles, still runs, still "works" if you forget to call it on a little-endian box
and test only on a big-endian one. That asymmetry is exactly how byte-order bugs used
to hide from a whole team for months: it worked on one architecture and silently
corrupted data on another.

### `INADDR_ANY` vs. a literal address

`sin_addr` needs a value too. `INADDR_ANY` (numerically `0.0.0.0`) doesn't mean "no
address" — it tells the kernel *"accept connections arriving on any of this machine's
network interfaces,"* which matters the moment a box has more than one (a LAN
interface and a Wi-Fi interface, say, or a container's internal bridge alongside its
host-facing one). Binding to a literal IP instead restricts you to traffic that
arrived on that one specific interface. A server binds `INADDR_ANY` almost always; a
literal address shows up when a machine deliberately wants to be reachable on only one
of its networks.

### A sharp edge in the API you're about to use

`inet_ntoa()`, which turns a `struct in_addr` back into a printable string, returns a
`char *` into a **static buffer owned by the library** — not memory you allocated, and
not memory that's yours alone. Call it twice before using the first result and you'll
get the same pointer back with the second address's text in it. This is a very old API
(pre-thread-safety as a design concern at all), which is exactly why `inet_ntop()`
exists as its replacement — it writes into a buffer *you* supply. You'll likely still
run into `inet_ntoa()` in code older than you are; know what it's actually handing back
before you trust it.

### Is any of this still how it's done?

The byte-order rule, yes, completely — every IP packet, every TCP header, every DNS
message on the internet today is big-endian on the wire, unchanged since the 1970s
ARPANET days, regardless of what's inside your phone or your laptop. What's changed is
how much of this you touch by hand: `getaddrinfo()` (a level up from what you're doing
this week) hides most manual byte-order juggling behind name resolution, and
`inet_pton()`/`inet_ntop()` replaced the address-conversion functions that weren't
IPv6-aware or thread-safe. You're doing it by hand this week for the same reason as
Day 1 — so the abstraction is a convenience later, not a black box.

### The Great Endian War

The terms "big-endian" and "little-endian" aren't engineering jargon invented for this
— they're a deliberate joke. In 1980, Danny Cohen wrote an internet-famous paper called
*"On Holy Wars and a Plea for Peace,"* borrowing the words straight from *Gulliver's
Travels*, where the empires of Lilliput and Blefuscu go to actual war over which end
of a soft-boiled egg you're supposed to crack. His point was that the byte-order
argument between hardware vendors was exactly that pointless — two functionally
equivalent conventions, fought over as if one were obviously correct. The joke stuck so
well that it's now the only name anyone uses, in every networking textbook and every
RFC that has to specify it.

## Task

Extend Day 1's program:

1. Build a `sockaddr_in` for port `9000`, address `INADDR_ANY`. Set `sin_family`,
   `sin_port` (through `htons`), `sin_addr.s_addr` (through `htonl`, or directly —
   `INADDR_ANY` is `0` either way, but write the conversion so the pattern is there for
   the next literal address you use). Zero `sin_zero` explicitly rather than relying on
   it being zeroed for you — `memset` the whole struct to `0` before filling it in is
   the idiom you'll see everywhere, and it also means you don't have to think about
   `sin_zero` again.
2. Print `sin_port` **twice**: once as the raw stored value, once run back through
   `ntohs()`. On a little-endian machine (almost certainly what you're on) those two
   numbers should look different, and the second one should read `9000`.
3. Dump the whole struct byte-by-byte: cast a pointer to it as
   `unsigned char *` and print each byte in hex, in memory order. Find the two bytes
   that hold the port and confirm which one is `0x23` and which is `0x28` — that's
   `9000` in big-endian, sitting right there in memory, regardless of what your CPU's
   own native order is.
4. As a two-line aside — not part of the checklist, just worth seeing once — detect
   your own machine's endianness at runtime: put a 4-byte `int` with the value `1` in
   memory, look at its first byte through an `unsigned char *`. `1` if little-endian,
   `0` if big-endian. This is the same trick `htons()` is built on internally.

Keep the `socket()`/`close()` scaffolding from Day 1 around it — this program still
doesn't call `bind()` yet, that's Day 3.

- File: `src/main.cpp`
- Compile: `g++ -std=c++20 -Wall -Wextra -o day2 src/main.cpp`
- You'll need `<netinet/in.h>` for `sockaddr_in`/`htons`/`htonl`, `<cstring>` for
  `memset`, in addition to what Day 1 already pulled in

### Checklist

- [ ] `sockaddr_in` filled for port `9000` on `INADDR_ANY`, zeroed first
- [ ] `sin_port` printed both raw and through `ntohs()`, and they differ
- [ ] the struct dumped byte-by-byte in hex, and the two port bytes identified by hand
- [ ] host endianness detected at runtime with the 1-byte trick
- [ ] zero warnings under `-Wall -Wextra`

## Quiz

1. What problem does network byte order actually solve — what goes wrong without it?
2. `sin_zero` is 8 bytes of padding in `sockaddr_in`. What is it padding *to*, and why
   does that matter for a function like `bind()`?
3. On a big-endian machine, what does `htons()` actually do to its argument, and why
   is that a dangerous thing to build a testing habit around?
4. What does binding to `INADDR_ANY` actually mean, in terms of what the kernel does
   differently versus binding to a specific literal address?
5. `inet_ntoa()` returns a `char *`. What are you not allowed to assume about that
   pointer, and what goes wrong if you call it twice before using the first result?
