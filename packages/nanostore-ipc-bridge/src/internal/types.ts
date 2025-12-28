export type Snapshot<T> = { id: string; rev: number; value: T }

export type MainRegisterFn = (id: string, store: any) => void

export type MainApi = {
  registerStore: MainRegisterFn
  isInitialized: () => boolean
}
