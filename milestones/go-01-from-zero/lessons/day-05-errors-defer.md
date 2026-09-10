# Errors are values, and defer is your destructor

## Theory

Go has no exceptions. None. No `try`, no `catch`, no `throw`, no stack unwinding you can
hook into. This is the single most argued-about decision in the language, and today is
about living with it — plus `defer`, the feature that fills the hole where a C++
destructor would go.

### Errors come back like any other value

```go order
f, err := os.Open("/no/such/file")
if err != nil {
	return err
}
defer f.Close()
```

Go functions can return more than one value, and the convention — enforced by nothing but
followed by everyone — is that the last one is an `error`. `nil` means it worked.

```
err: open /no/such/file: no such file or directory
```

`error` is not a special language construct. It is an ordinary one-method interface, and
you have already met its shape:

```go
type error interface {
	Error() string
}
```

That is the entire type. Anything with an `Error() string` method is an error, which
means you write your own error types the same way you write anything else.

Yes, you will type `if err != nil` a great deal. Roughly one line in twenty of real Go is
that line. People find this either honest or unbearable and there is not much middle
ground. The argument in its favour: an exception is an invisible second control-flow graph
through your program, and every call is a potential jump to somewhere you cannot see. Go
makes the unhappy path the same size on the page as the happy path, because at 3am the
unhappy path is the one you are reading. The argument against: it is a lot of typing, it
is easy to `return err` without adding context, and unlike an exception, an error is
trivially *ignorable* — `f, _ := os.Open(...)` compiles fine.

### Wrapping: keep the cause, add the context

Returning a bare `err` upward is how you end up with `no such file or directory` and no
idea which file. Wrap it with `%w`:

```go order
_, err := os.Open("/no/such/file")
wrapped := fmt.Errorf("loading config: %w", err)
fmt.Println(wrapped)
fmt.Println(errors.Is(wrapped, os.ErrNotExist))
```

```
loading config: open /no/such/file: no such file or directory
true
```

`%w` is `%v` plus a hidden link back to the original error. That link is what
`errors.Is` follows — so a caller ten frames up can still ask "was this ultimately a
file-not-found?" and get `true`, without string matching and without caring how many
layers added context on the way. `errors.As` does the same for extracting a specific
error *type*.

Swap the verb and watch the link vanish:

```
with %w: true
with %v: false
```

Same message text either way — only the machine-readable link differs. Use `%w` when the
caller might reasonably want to inspect the cause; use plain `%v` when you are
deliberately hiding the internals. Wrapping everything makes your internal error
types part of your public API, which is a real cost.

### defer: run this on the way out, whatever happens

```go
defer fmt.Println("third")
defer fmt.Println("second")
defer fmt.Println("first")
fmt.Println("body")
```

```
body
first
second
third
```

Deferred calls run when the surrounding **function** returns — not at the end of the
block, which is a genuine difference from a C++ destructor and the source of the classic
"I deferred `f.Close()` inside a loop and ran out of file descriptors" bug. They run in
**LIFO** order, which is exactly right: the thing you acquired last is the thing you
release first.

This is Go's answer to RAII, and it is a worse answer in one specific way and a better one
in another. Worse: it is opt-in and manual, so forgetting `defer f.Close()` leaks, where a
C++ destructor could not be forgotten. Better: it is *visible at the call site*. You can
see the cleanup on the line after the acquisition, rather than having to know what some
type's destructor does.

Crucially, deferred calls still run when the function panics, which is what makes them
trustworthy for unlocking mutexes:

```go
mu.Lock()
defer mu.Unlock()
```

### The defer gotcha: arguments evaluate now, the call happens later

```go order
i := 1
defer fmt.Println("deferred saw i =", i)
i = 99
fmt.Println("at the end i =", i)
```

```
at the end i = 99
deferred saw i = 1
```

The arguments were evaluated the moment the `defer` statement ran; only the *call* was
postponed. If you want the late value, defer a closure instead — `defer func() {
fmt.Println(i) }()` — which captures the variable rather than its value.

### panic exists, and is not for errors

`panic` unwinds the stack running deferred functions, and `recover` inside a deferred
function stops it. It looks like exceptions and is not meant to be used like them: panic
is for genuinely unrecoverable programmer error — index out of range, nil dereference, an
invariant you thought was impossible. A library that panics on a bad input is considered
badly behaved; it should return an error. The main legitimate use of `recover` is at the
top of a server's request handler, so one broken request doesn't take down the process.

## Quiz

1. What is the `error` type in Go, exactly — what makes something an error?
2. What is the difference between wrapping an error with `%w` and formatting it with
   `%v`, and what becomes possible for the caller?
3. When exactly does a deferred call run, and in what order relative to other defers in
   the same function?
4. `i := 1; defer fmt.Println(i); i = 99`. What prints, and why?
5. When is `panic` the right choice rather than returning an error, and where is
   `recover` legitimately used?

## Task

Write a small function that can fail, and make the failure informative.

1. Write `func readConfig(path string) ([]byte, error)` that opens a file, reads it, and
   returns the bytes. Handle every error rather than ignoring it.
2. Call it with a path that does not exist. Print the error and record it.
3. Wrap the error with `%w` and some context of your own, print it again, and confirm
   with `errors.Is(err, os.ErrNotExist)` that the cause survives the wrap.
4. Change the `%w` to `%v` and show `errors.Is` now returning false. That contrast is the
   point of the exercise.
5. Add a `defer` that closes the file, plus two more defers that print, so you can observe
   the LIFO order for yourself.
6. Reproduce the argument-evaluation gotcha: defer a print of a variable, change the
   variable, and see which value appears. Then fix it with a closure.

- File: `go/day05/config.go`
- Run: `go run go/day05/config.go`

### Checklist

- [ ] a function returning `([]byte, error)` with every error handled
- [ ] an error wrapped with `%w`, and `errors.Is` finding the cause through the wrap
- [ ] the same check failing once `%w` becomes `%v`
- [ ] three defers observed running in LIFO order
- [ ] the deferred-argument gotcha reproduced, then fixed with a closure
