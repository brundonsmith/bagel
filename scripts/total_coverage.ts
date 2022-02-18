
import { path } from '../compiler/deps.ts'

const summary = await Deno.readTextFile(path.resolve(Deno.cwd(), './coverage/summary.txt'))

const pairs = summary.split('\n')
    .filter(line => line.trim())
    .map(line => line.match(/.*\(([0-9]+\/[0-9]+)\).*/)?.[1].split('/').map(Number) as [number, number])

const totals = pairs.reduce(([accCovered, accTotal], [covered, total]) => [accCovered + covered, accTotal + total], [0, 0])

console.log(summary)
console.log(`Total coverage: ${((totals[0] / totals[1]) * 100).toFixed(0)}% (${totals[0]}/${totals[1]})`)