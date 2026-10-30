// Minimal pub/sub so systems talk through events instead of holding references to each other.
export class EventBus {
  constructor() {
    this.handlers = {};
  }

  on(event, fn) {
    (this.handlers[event] ??= []).push(fn);
    return () => this.off(event, fn);
  }

  off(event, fn) {
    const list = this.handlers[event];
    if (list) this.handlers[event] = list.filter((f) => f !== fn);
  }

  emit(event, payload) {
    const list = this.handlers[event];
    if (list) for (const fn of list) fn(payload);
  }
}
