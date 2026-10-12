import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { BLOCKS, cellKey, getBlock, loadGameData, type CellRef, type GameData, type MachineState } from '@agora/shared';
import { Dialog } from '../../ui/common';
import type { WorldAsk } from '../inputActs';

/** The recipes a station makes: those whose `station` is the block's station (recipes.json, blocks.json). */
export function recipesAt(data: GameData, block: string): GameData['recipes'] {
  const station = getBlock(BLOCKS, block)?.station;
  return station === undefined ? [] : data.recipes.filter((recipe) => recipe.station === station);
}

/** The batch a machine holds on a cell (one per machine), or undefined when it holds none. */
export function batchAt(machines: readonly MachineState[], at: CellRef): MachineState | undefined {
  const key = cellKey(at.x, at.y);
  return machines.find((machine) => machine.cell === key);
}

/**
 * The crafting panel of a station (ADR-053, P17.25): the recipes it makes, each with its inputs and
 * output, and for a machine (the furnace) the batch it holds: in progress with the days left, or
 * ready to collect. A craft asks the server with the recipe as its target; the server takes the
 * inputs from the bag, and a busy machine refuses a second batch.
 */
export function CraftPanel({
  at,
  block,
  batch,
  onAsk,
  onClose,
}: {
  at: CellRef;
  block: string;
  batch: MachineState | undefined;
  onAsk: WorldAsk;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const data = useMemo(() => loadGameData(), []);
  const recipes = recipesAt(data, block);
  return (
    <Dialog title={t(`worlds.block.${block}`)} onClose={onClose} className="wh-panel">
      {batch !== undefined && <BatchStatus at={at} batch={batch} onAsk={onAsk} />}
      {recipes.length === 0 ? (
        <p>{t('worlds.craft.nothing')}</p>
      ) : (
        <ul className="wh-list">
          {recipes.map((recipe) => {
            const output = t(`worlds.item.${recipe.output.item}`);
            const inputs = recipe.inputs.map((input) => `${t(`worlds.item.${input.item}`)} ×${input.qty}`).join(', ');
            return (
              <li key={recipe.id}>
                <button type="button" disabled={batch !== undefined} onClick={() => onAsk('craft', at, undefined, recipe.id)}>
                  <span>
                    {t('worlds.craft.inputs')} : {inputs}
                  </span>{' '}
                  <span>
                    {t('worlds.craft.output')} : {output} ×{recipe.output.qty}
                  </span>{' '}
                  <span className="wh-take">{t('worlds.craft.craft')}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Dialog>
  );
}

/** A machine's batch: the days left while it runs, or the output to take once it is done. */
function BatchStatus({ at, batch, onAsk }: { at: CellRef; batch: MachineState; onAsk: WorldAsk }) {
  const { t } = useTranslation();
  const item = t(`worlds.item.${batch.output}`);
  if (batch.daysLeft > 0) return <p role="status">{t('worlds.craft.inProgress', { item, count: batch.daysLeft })}</p>;
  return (
    <div className="wh-chest-actions">
      <p role="status">{t('worlds.craft.ready', { item, count: batch.qty })}</p>
      <button type="button" onClick={() => onAsk('collect', at)}>
        {t('worlds.craft.collect')}
      </button>
    </div>
  );
}
