# Hello, and a compiler that says no

## Theory

Go is a small language. That is not marketing — the spec is about 100 pages, it has 25
keywords, and you can hold most of it in your head. C++ has 90-odd keywords and a
standard nobody has read end to end. The whole design is a series of arguments about what
to *leave out*, and the fastest way to understand Go is to keep asking "what did they
refuse to add, and why".

Today: getting a program to run, and meeting the two refusals that make newcomers
furious in week one and grateful in month three.

### The smallest program that works

```go order
package main

import "fmt"

func main() {
	fmt.Println("hello from Go")
}
```

```
hello from Go
```

Four things worth naming:

- **`package main`** — every Go file belongs to a package. The one called `main` is
  special: it is the package that produces an executable. Everything else is a library.
- **`import "fmt"`** — the standard library's formatted-I/O package. Roughly `<cstdio>`
  and `<iostream>` in one, minus the operator overloading.
- **`func main()`** — no arguments, no return value. Command-line arguments live in
  `os.Args`, and you set the exit code with `os.Exit`. There is no `int main(int argc,
  char **argv)` here.
- **The tab.** Go indents with tabs, and you don't get an opinion. More on that below.

Two ways to run it:

```bash
go run hello.go      # compile to a temp dir and execute, in one step
go build hello.go    # leave an executable called ./hello next to the source
```

`go run` feels like a scripting language and isn't one — it really is compiling. On this
machine, a warm `go build` of that file takes **0.3 seconds** and produces a **2.2 MB**
binary. That size is not bloat so much as honesty: the Go runtime, garbage collector and
scheduler are all inside it. In exchange:

```
$ file hello
hello: ELF 64-bit LSB executable, x86-64, statically linked

$ ldd hello
	not a dynamic executable
```

**Statically linked. No shared library dependencies at all.** Copy that file to a bare
container with nothing in it and it runs. If you have ever shipped a C++ binary and
discovered the target box had the wrong `libstdc++`, you can probably see why this single
property is most of the reason Docker, Kubernetes, Terraform and Prometheus are all
written in Go. Deployment is `scp`.

### Refusal one: an unused variable is an error

```go
func main() {
	count := 42
	fmt.Println("hi")
}
```

```
./bad.go:6:2: declared and not used: count
```

Not a warning. The build **fails**. Every other language you have used treats this as a
lint at most — C++ has `-Wunused-variable`, which is off unless you asked for it and
which everyone ignores anyway inside a wall of template errors.

### Refusal two: an unused import is also an error

```go
import (
	"fmt"
	"os"
)
```

```
./bad2.go:5:2: "os" imported and not used
```

This one gets people genuinely angry, because it fires constantly while you are still
*writing* the code — you comment out four lines to test something and the program stops
compiling for reasons unrelated to what you were doing.

The reasoning is that both of these are almost always the fingerprint of a real bug:
you declared a variable meaning to use it and then used a different one; you imported a
package for a call you deleted. Catching them costs a rebuild; missing them costs an
afternoon. The unused import has a second motive too — an import is a dependency, and
dependencies you don't use still cost compile time for everyone who builds your package.

The escape hatches exist, and they are deliberately ugly enough that you won't leave them
in by accident:

```go
_ = count   // "yes, I know, I am not using this yet"
```

```go
import _ "net/http/pprof"   // import ONLY for its side effects (its init function)
```

That second one is not a hack — it is the standard way to register something. Importing
`net/http/pprof` for its side effect is how you bolt a live profiler onto a running Go
server, which is a genuinely great trick you will meet again.

### Refusal three: you don't get to have opinions about formatting

```bash
gofmt -d ugly.go     # show what it would change
gofmt -w ugly.go     # rewrite the file in place
```

```diff
 package main
+
 import "fmt"
-func main(){
-x:=1
-fmt.Println( x )
+
+func main() {
+	x := 1
+	fmt.Println(x)
 }
```

There is one canonical format, a tool that produces it, and no configuration. Tabs, not
spaces. Braces where `gofmt` puts them, not where you like them. Every Go codebase on
earth looks the same, and the entire category of pull-request argument about brace style
simply does not exist. After a decade of `.clang-format` files that differ per project,
this is a bigger quality-of-life win than it sounds.

> [!NOTE]
> **The origin story, and the more interesting truth behind it.** Go is usually said to
> have been conceived while three engineers — Robert Griesemer, Rob Pike and Ken Thompson
> (yes, *that* Ken Thompson, of Unix and B) — waited 45 minutes for a C++ binary at Google
> to compile, in September 2007. Pike himself calls this "the origin myth for Go": the
> 45-minute build was real, and so was the frustration, but the tidy anecdote is tidier
> than what happened. Which is a useful thing to know in its own right, because the
> *frustration* is what the language is actually built out of. Nearly every refusal above
> is downstream of "how long does the build take, and how much does the reader have to
> know".

### Worth knowing: the rule everyone calls a language rule is technically optional

The Go specification ships with your Go installation — `/usr/local/go/doc/go_spec.html`
on a typical Linux setup. Search it for the unused-variable rule and here is the exact
wording:

> Implementation restriction: A compiler may make it illegal to declare a variable inside
> a function body if the variable is never used.

**May.** The language does not require it; it *permits* a compiler to. The `gc` compiler
you are using exercises that permission, so in practice it is a rule — but it is a rule
the toolchain chose, not one the language demands, which is a distinction almost nobody
who complains about it knows. Reading the actual spec of a language you are learning is
an unreasonably high-value hour, and Go's is short enough to make that realistic.

## Quiz

1. `go run` executes your program immediately, the way `python script.py` does. What is
   it actually doing under the hood, and how is that different from an interpreter?
2. Your build fails with `"os" imported and not used`. Give the two separate reasons Go's
   designers made this an error rather than a warning.
3. A Go "hello world" binary is about 2 MB, where the C equivalent is a few kilobytes.
   What is in there, and what do you get in exchange for the size?
4. You are mid-debug, you have commented out the only line that used a variable, and the
   compiler now refuses to build. What is the one-line escape hatch, and why is it written
   to be ugly?
5. What does `import _ "net/http/pprof"` do, given that the underscore means you never
   reference the package by name?

## Task

Get Go on your machine and make the compiler shout at you on purpose. The refusals are
the lesson; meeting them deliberately now is much better than meeting them at 11pm.

Install Go from your package manager or from the official downloads — `go version` should
print something like `go version go1.24.7 linux/amd64`.

1. Write and run the hello program with `go run`.
2. Build it with `go build`, then check the result: how big is the binary, and what does
   `file` say about it? On Linux, what does `ldd` say?
3. Add a variable you never use. Record the exact error message.
4. Add an import you never use. Record that error too.
5. Make both errors go away *without* deleting the lines — use `_ =` for the variable and
   the blank import for the package.
6. Deliberately mangle the formatting — no spaces around operators, brace on its own
   line, spaces instead of tabs — then run `gofmt -d` on it and read the diff before
   running `gofmt -w`.

Keep every error message you saw in the file as a comment beside the line that caused it.

- File: `go/day01/hello.go`
- Run: `go run go/day01/hello.go`

### Checklist

- [ ] `go version` printed, and hello world ran under `go run`
- [ ] binary built, its size and `file`/`ldd` output recorded
- [ ] `declared and not used` triggered on purpose, message recorded
- [ ] `imported and not used` triggered on purpose, message recorded
- [ ] both silenced with `_` rather than by deleting the lines
- [ ] `gofmt -d` diff read before `gofmt -w` was run
