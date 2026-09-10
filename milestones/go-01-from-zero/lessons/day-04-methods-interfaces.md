# Methods, and interfaces you never declare

## Theory

Go has no classes, no inheritance, no `virtual`, no constructors and no `this`. It has
structs, functions attached to types, and one of the better ideas in mainstream language
design: interfaces that types satisfy without ever mentioning them.

### A method is a function with a receiver

```go
type Counter struct {
	n int
}

func (c *Counter) Bump() {
	c.n++
}
```

The `(c *Counter)` before the name is the **receiver**. That is the whole mechanism —
there is no class body, methods live at package level next to everything else, and the
receiver is an ordinary parameter that happens to be written in front. You can define
methods on any named type you declared, not just structs:

```go
type Celsius float64

func (c Celsius) String() string { return fmt.Sprintf("%.1f°C", float64(c)) }
```

### The one decision that trips everyone: value or pointer receiver

```go
func (c Counter) BumpValue()    { c.n++ }
func (c *Counter) BumpPointer() { c.n++ }
```

```
after value receiver:   0
after pointer receiver: 1
```

`BumpValue` receives a **copy** of the Counter. It increments the copy, the copy is
discarded, and your original is untouched — and nothing warns you, because incrementing a
local is perfectly legal. `BumpPointer` receives the address and modifies the real thing.

The rule in practice: **if the method modifies the receiver, or the struct is large, use
a pointer. Then use a pointer for all its methods**, even the ones that don't need it,
because a type whose method set is half values and half pointers is a type whose
behaviour depends on how you happened to call it.

Go does hide one piece of sugar here. You never write `(&c).BumpPointer()` — if `c` is
addressable, Go inserts the `&` for you. That is why `c.BumpPointer()` compiles when `c`
is a `Counter` and not a `*Counter`. C++ makes you pick `.` or `->`; Go decided that
distinction never carried information and removed it.

### Interfaces: satisfied by accident, on purpose

```go
type Greeter interface {
	Greet() string
}

type English struct{ Name string }

func (e English) Greet() string { return "Hello, " + e.Name }
```

```go
var g Greeter = English{Name: "world"}
fmt.Println(g.Greet())
```

```
Hello, world
```

Notice what is **not** there. `English` does not say `implements Greeter`. There is no
`: public Greeter`, no `@Override`, no registration. It has a method with the right name
and signature, so it satisfies the interface. Full stop.

This is **structural typing**, and it inverts who is in charge. In C++ or Java, the
author of a class decides which interfaces it implements, and if they didn't think of
yours you are writing an adapter. In Go the *consumer* declares the interface, and every
existing type that happens to fit is instantly compatible — including types from
libraries written years before your interface existed.

Watch it happen with the standard library:

```go
var sb strings.Builder
fmt.Fprintf(&sb, "written through io.Writer: %d", 42)
```

```
written through io.Writer: 42
```

`fmt.Fprintf` takes an `io.Writer`. `strings.Builder` never mentions `io.Writer`
anywhere. It has a `Write([]byte) (int, error)` method, which is all `io.Writer` asks
for, so it fits. The same one-method interface is satisfied by files, network
connections, HTTP response writers, gzip compressors, hash functions and
`os.Stdout` — which is why "write it to a string instead of the network" is a
one-line change in Go and a refactor in most languages.

`io.Writer` is worth staring at, because it is the whole philosophy in four lines:

```go
type Writer interface {
	Write(p []byte) (n int, err error)
}
```

> [!NOTE]
> **"The bigger the interface, the weaker the abstraction."** That is Rob Pike, in his Go
> proverbs, and it is the opposite of the instinct most of us bring from other languages
> where interfaces accumulate methods to be "complete". In Go the most useful interfaces
> in the entire ecosystem have exactly one method: `io.Writer`, `io.Reader`, `error`,
> `fmt.Stringer`, `http.Handler`. A one-method interface is trivially satisfiable, so
> almost everything satisfies it, so it composes with everything.
>
> You will also constantly hear **"accept interfaces, return structs"** quoted alongside
> it, usually as though it were a second proverb. It isn't — it is a community idiom that
> never made the canonical list — but it falls straight out of the real one: take the
> loosest thing you can work with, hand back the most specific thing you have.

### Worth knowing: the compile-time assertion nobody shows beginners

Because nothing declares intent, nothing tells you when you *meant* to satisfy an
interface and got the signature subtly wrong — a value receiver where a pointer was
needed, `Str()` instead of `String()`. The code compiles; it just isn't a `Stringer`, and
you find out when your log line prints `{0 0}` instead of your nice format.

The idiom for this is a variable declaration that does nothing:

```go
var _ Greeter = English{}     // fails to compile if English stops satisfying Greeter
var _ Greeter = (*Spanish)(nil)  // same check, for a pointer receiver, with no allocation
```

Assign to the blank identifier, so nothing is stored and nothing is used, but the type
check still runs — and when it fails it tells you exactly which method is missing:

```
./assert.go:16:17: cannot use Broken{} (value of struct type Broken) as Greeter value in
variable declaration: Broken does not implement Greeter (missing method Greet)
``` You will find this line near the top of a great many real Go files, and
it is one of those things that looks like line noise until someone explains it once.

## Quiz

1. What is a receiver, and where does it appear in a Go method declaration?
2. A method with a value receiver increments a field of its receiver. Why does the
   caller's value not change, and why is there no warning?
3. What does a Go type have to write in order to implement an interface?
4. `strings.Builder` never mentions `io.Writer`, yet `fmt.Fprintf` accepts a pointer to
   one. Explain how, and say who gets to define the interface in that arrangement.
5. What does the line `var _ Greeter = English{}` accomplish, given that it stores nothing
   and is never referenced?

## Task

Build a tiny shape library and then discover that you already implemented a standard
library interface without trying.

1. Define a `Rect` struct with width and height, and a `Circle` with a radius.
2. Give each an `Area() float64` method. Choose value or pointer receivers deliberately
   and write a one-line comment saying why.
3. Define `type Shape interface { Area() float64 }`, put both into a `[]Shape`, and loop
   over it printing each area. Note that neither struct mentions `Shape`.
4. Add a `Scale(f float64)` method that actually modifies the receiver. Get it wrong on
   purpose first — value receiver — observe nothing happening, then fix it.
5. Give `Rect` a `String() string` method, then print a `Rect` with `fmt.Println` and
   watch the output change without you calling `String` yourself. Work out which
   interface you just satisfied by accident.
6. Add the `var _ Shape = ...` assertion for both types, then break one signature on
   purpose and record the error.

- File: `go/day04/shapes.go`
- Run: `go run go/day04/shapes.go`

### Checklist

- [ ] two types with the same method, collected in one slice of an interface type
- [ ] neither type names the interface anywhere
- [ ] a value receiver observed failing to modify, then fixed with a pointer receiver
- [ ] `fmt.Println` output changed by adding a `String()` method
- [ ] a compile-time interface assertion added, broken on purpose, and the error recorded
