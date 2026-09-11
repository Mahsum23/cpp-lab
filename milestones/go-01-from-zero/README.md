# Milestone Go-01 — Go, From Zero

**Track:** Go · **Days:** 6 · **Time:** ~3 hours total, in 25–30 minute sittings

Go is a small language built almost entirely out of arguments about what to leave out.
This milestone goes from an empty file to goroutines, stopping at the handful of places
where Go behaves differently from what an experienced programmer's instincts predict.

The through-line is *why*: Go's designers left unusually good records of their reasoning,
and a beginner who knows the reason for a rule remembers the rule. Where a comparison to
C, C++ or Java makes the difference sharper, the lessons make it — without assuming the
reader knows any particular one of them.

**Prerequisites:** the Go toolchain, and nothing else. No modules, no dependencies, no
database, no network. Every exercise is a single file run with `go run`.

---

### Day 1 — Hello, and a compiler that says no
**Concept:** `package main`, `go run` versus `go build`, and the two refusals that make
newcomers furious in week one — unused variables and unused imports are hard errors.
**Task:** hello world, then trigger both errors deliberately and silence them with `_`
rather than by deleting code.
**Worth knowing:** the unused-variable rule is not, technically, a language rule. The
spec that ships with your Go install says a compiler *may* make it illegal — an
"implementation restriction" the `gc` toolchain chooses to exercise. Also `import _` for
side effects, which is how a live profiler gets bolted onto a running server in one line.
**Watch for:** the instinct to fight the formatter. There is one canonical format, a tool
that produces it, and no configuration.

### Day 2 — Zero values, and the walrus that bites
**Concept:** `var` versus `:=`, the guarantee that every declaration is initialised, and
the absence of implicit numeric conversion.
**Task:** print every zero value, then reproduce shadowing on purpose and fix it.
**Worth knowing:** untyped constants are evaluated at arbitrary precision during
compilation, so a constant larger than `uint64` is legal until something forces a type on
it — and the overflow error quotes the exact value back at you.
**Watch for:** shadowing. `go vet` has thirty-odd analyzers and deliberately does not
include this one, because on idiomatic Go it fires constantly on shadowing that is
intentional. This bug is yours to catch.

### Day 3 — Slices are not arrays
**Concept:** arrays are values that copy; slices are three-word headers that share. `len`
versus `cap`, and why `append` must be assigned back.
**Task:** reproduce the aliasing trap, then fix it with a three-index slice.
**Worth knowing:** a slice pins its whole backing array, so a 60-byte view of a 500 MB
file keeps all 500 MB reachable. That is how you leak memory in a garbage-collected
language with no missing `free`, and `slices.Clone` is the fix.
**Watch for:** the sub-slice whose capacity runs to the end of the original. It looks like
a two-element slice and can write over data it was never given.

### Day 4 — Methods, and interfaces you never declare
**Concept:** receivers, the value-versus-pointer decision, and structural typing — a type
satisfies an interface by having the methods, not by saying so.
**Task:** two shapes, one interface neither of them names, and a `String()` method that
changes `fmt.Println` output without being called.
**Worth knowing:** `var _ Iface = Type{}` — an assignment to the blank identifier that
stores nothing and exists purely to make the compiler check the fit, naming the missing
method when it breaks.
**Watch for:** the value receiver that modifies its copy and silently does nothing.

### Day 5 — Errors are values, and defer is your destructor
**Concept:** no exceptions anywhere in the language; multiple return values; `%w`
wrapping and `errors.Is`; `defer` and its LIFO order.
**Task:** a function that can fail, wrapped so the cause survives, then the same thing
with `%v` so it doesn't.
**Worth knowing:** `defer` evaluates its arguments immediately and postpones only the
call — so `defer fmt.Println(i)` captures `i` as it was, not as it ends up.
**Watch for:** `defer` is function-scoped, not block-scoped. Deferring a `Close` inside a
loop holds every handle until the whole function returns.

### Day 6 — Goroutines and channels
**Concept:** `go f()`, the M:N scheduler, unbuffered channels as a rendezvous,
`sync.WaitGroup`, and the race detector.
**Task:** deadlock on purpose, race a counter, then fix it two different ways.
**Worth knowing:** goroutine stacks start at about 2 KB and grow by being copied — which
is only possible because Go can find and rewrite pointers into them, exactly what C
cannot do, and why C stacks are reserved 8 MB up front.
**Watch for:** the deadlock detector only fires when *every* goroutine is asleep. One
goroutine blocked forever while the program runs on is the leak that actually happens in
production, and nothing will tell you.

---

## After this milestone

The obvious next step is a Go milestone with a real program in it — an HTTP service, or a
concurrent worker pool with `context` cancellation — rather than more language features.
As with every track here, the next milestone gets specified once this one is done, so it
can be calibrated against what actually turned out to be hard.
