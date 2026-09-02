/**
 * Move um item de `from` para `to`, devolvendo uma lista nova.
 *
 * Índice fora do intervalo devolve a lista intacta em vez de lançar: arrastar
 * e soltar fora da área produz índice inválido com facilidade, e embaralhar a
 * ordem do tenant por causa disso seria pior que ignorar o gesto.
 */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  const fora =
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    to < 0 ||
    from >= list.length ||
    to >= list.length;

  if (fora || from === to) return [...list];

  const copia = [...list];
  const [item] = copia.splice(from, 1);
  copia.splice(to, 0, item);
  return copia;
}
