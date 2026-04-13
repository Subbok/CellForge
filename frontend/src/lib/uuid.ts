export const uuid: () => string =
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? () => crypto.randomUUID()
    : () =>
        'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
          const r = (Math.random() * 16) | 0;
          return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
        });
