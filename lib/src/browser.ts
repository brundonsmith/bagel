import { observable } from "mobx"

export const browserState: {
    location?: Location
} = observable({})