/** Supplied by the application, captured once for a preparation/retry. */
export interface IdSource { nextId(): string }
export interface Clock { now(): string }
export interface PreparationContext { ids: IdSource; clock: Clock }
