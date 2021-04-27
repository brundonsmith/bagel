
# Bagel 🥯

Bagel is a strongly-typed, JavaScript-targeted programming language designed 
around two main ideas:
1) Pure **functions** and stateful **procedures** are separate concepts. Functions cannot affect app state, and procedures cannot return values.
2) Reactivity is built-in at the language level. All state (variables, etc) can be **observed** and reacted to automatically by the rest of the app. This is naturally relevant to front-end UIs, but it's useful for other things as well. For an introduction to the general concept, see this [blog post](https://hackernoon.com/the-fundamental-principles-behind-mobx-7a725f71f3e8).

<hr>

## NOTE: This is a work in progress, and many of the described features are not implemented yet

<hr> 

As much as possible Bagel aims to remain comfortable and familiar for people who 
have worked with JavaScript/TypeScript. It has the same basic data types, 
syntax, and semantics, and compiles to JS very predictably. What it doesn't have
is many of JS's footguns, and some of its more dynamic features that make it
really hard to guarantee things with types.

Bagel is statically-typed, and most of the types it has (syntax and semantics) aim to be almost interchangeable with TypeScript's. With that said, the type system is not nearly as rich or as complex as TypeScript's; it doesn't implement advanced features like string template types and intersection types. It also doesn't have generics (this could 
change; not sure yet). The goals is for the type system (like the language 
itself) to be simple and practical, discouraging excessive cleverness in favor
of straightforward application code that has strong guarantees.

Other notable features:
- A [pipeline operator](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Pipeline_operator)
- `null`/`undefined` have been replaced with a unified `nil` to avoid confusion
- JavaScript's implicit casting is prevented in most cases
- All functions and procedures support partial-application (currying)
- Iterator versions of core array methods (map/filter/slice/etc) are made 
available to avoid copying arrays all over the place (they pair nicely with the 
pipeline operator)
- There is no global state; global values are all immutable. A main() procedure 
is called when the app starts, and any mutable state has to be initialized 
there and passed down to sub-procedures.