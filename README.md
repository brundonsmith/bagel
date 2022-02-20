
# Bagel 🥯

Bagel is a strongly-typed, JavaScript-targeted programming language designed 
around two main ideas:
1) Pure **functions** and stateful **procedures** are separate concepts. Functions cannot affect app state, and procedures cannot return values.
2) Reactivity is built-in at the language level. All mutable state (variables, etc) can be **observed** and reacted to automatically by the rest of the app. This is naturally relevant to front-end UIs, but it's useful for other things as well. For an introduction to the general concept, see this [blog post](https://hackernoon.com/the-fundamental-principles-behind-mobx-7a725f71f3e8).

Other goals include:
- Being familiar and instantly comfortable for JavaScript/TypeScript developers, while simplifying certain things and sanding off many of JS's rougher edges
- Being practical for real-world development with a comprehensive set of built-in tooling, ergonomic JS interop, etc
- Having a sound (informally, at least for now) static type system with more powerful and reliable guarantees than TypeScript can provide, because it's working with a fresh language instead of being layered over JavaScript

Blog posts on the language:
- [The Bagel Language](https://www.brandons.me/blog/the-bagel-language)
- [Bagel Bites (Update on the Bagel Language)](https://www.brandons.me/blog/bagel-bites)
- [Bagel Bites: Type Refinement](https://www.brandons.me/blog/bagel-bites-refinement)

## Trying it out

> Note! Bagel is still pre-v0.1 and constantly in flux. No guarantees are made about anything continuing to work the way it does right now, or even working at all right now. These instructions are purely for the curious!

Bagel runs on Deno, so you'll first need that [installed](https://deno.land/#installation).

If you're using VSCode, there's a (very much in-progress) extension [here](https://github.com/brundonsmith/bagel-language) which will provide some basic syntax highlighting. It includes scripts for automatically installing it on Windows or macOS.

You can run the Bagel compiler directly via Deno, but that can be a little annoying, so `compiler/run.sh` and `compiler/run.bat` are provided. For the optimal experience, I recommend symlinking one of these scripts into your path under the name `bagel`.

With that, you should be able to do the following:
```bash
bagel build tests/todo-app
```

And then you can open `tests/todo-app/index.html` in a web browser and see a functioning todo app.