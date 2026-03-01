declare module 'asciinema-player' {
  export function create(
    src: string | Record<string, unknown>,
    container: HTMLElement,
    options?: Record<string, unknown>
  ): { dispose?: () => void }
}
