import type { ReviewArt } from './art';
import type { ReviewScene } from './scene';
import {
  ALL_PLANTS,
  PLANT_GROUPS,
  REVIEW_CROPS,
  REVIEW_TREES,
  type ReviewCrop,
  type ReviewTree,
} from './plantCatalog';

export function mountPlantCollection(art: ReviewArt, scene: ReviewScene, onCrop: () => void) {
  const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  const copy = (source: HTMLCanvasElement, label: string) => {
    const c = document.createElement('canvas');
    c.width = source.width;
    c.height = source.height;
    c.getContext('2d')!.drawImage(source, 0, 0);
    c.setAttribute('role', 'img');
    c.setAttribute('aria-label', label);
    return c;
  };
  const options = (trees: boolean) =>
    PLANT_GROUPS.map((group) => {
      const plants = (trees ? REVIEW_TREES : REVIEW_CROPS).filter((p) => p.category === group);
      return plants.length
        ? `<optgroup label="${group}">${plants.map((p) => `<option value="${p.id}">${p.label}</option>`).join('')}</optgroup>`
        : '';
    }).join('');
  const cropPicker = document.createElement('label');
  cropPicker.className = 'crop-growth-control';
  cropPicker.innerHTML = `Plant<select id="crop-species">${options(false)}</select>`;
  el('crop-growth').parentElement!.before(cropPicker);
  const cropItems = document.createElement('div');
  cropItems.className = 'plant-items';
  el('crop-preview').after(cropItems);
  const treePicker = document.createElement('div');
  treePicker.innerHTML = `<label class="crop-growth-control">Specimen tree<select id="tree-species">${options(true)}</select></label><button id="tree-bloom" class="plant-phase" aria-pressed="false">Show blossoms</button><p class="growth-caption">Changes the tree at the back of the clearing.</p>`;
  el('growth-preview').before(treePicker);
  const treeItems = document.createElement('div');
  treeItems.className = 'plant-items';
  el('growth-preview').after(treeItems);
  const opener = document.createElement('button');
  opener.id = 'plants-open';
  opener.textContent = 'Plants · 34 ↗';
  el('gallery-open').before(opener);
  const dialog = document.createElement('dialog');
  dialog.id = 'plant-gallery';
  dialog.innerHTML = `<div class="gallery-heading"><div><span class="eyebrow">THE BOTANICAL COLLECTION</span><h2>From seed to harvest.</h2></div><button id="plants-close" aria-label="Close plant collection">Close ×</button></div><p>18 existing crops, six new flowers, six orchard trees and four forest trees. Choose a plant to see it in the clearing.</p><div class="plant-filters"><label>Find a plant<input id="plant-search" type="search" placeholder="Radish, rose, apple…" /></label><label>Plant type<select id="plant-filter"><option value="all">All plants</option>${PLANT_GROUPS.map((g) => `<option>${g}</option>`).join('')}</select></label><span id="plant-count" aria-live="polite"></span></div><div id="plant-cards" class="plant-grid"></div>`;
  document.body.append(dialog);
  const items = (id: string, target: HTMLElement) => {
    target.replaceChildren();
    for (const [source, label] of [
      [art.seeds.get(id)!, 'Seeds'],
      [
        art.harvest.get(id)!,
        REVIEW_TREES.some((t) => t.id === id && t.existing) ? 'Natural seed' : 'Harvest',
      ],
    ] as const) {
      const fig = document.createElement('figure'),
        caption = document.createElement('figcaption');
      caption.textContent = label;
      fig.append(copy(source, `${id} ${label}`), caption);
      target.append(fig);
    }
  };
  function sync(): void {
    el<HTMLSelectElement>('crop-species').value = scene.cropSpecies;
    el<HTMLSelectElement>('tree-species').value = scene.treeSpecies;
    items(scene.cropSpecies, cropItems);
    items(scene.treeSpecies, treeItems);
    const orchard = art.orchard.get(scene.treeSpecies);
    const stages = orchard ?? [
      ...art.growth.get(scene.treeSpecies)!,
      art.props.new.get(scene.treeSpecies)!,
    ];
    el('growth-preview').replaceChildren(
      ...stages.map((source, i) => {
        const c = copy(source, `${scene.treeSpecies} stage ${i + 1}`);
        c.style.height = `${[25, 40, 58, 70, 70][i]}px`;
        return c;
      }),
    );
    el('tree-bloom').hidden = !orchard;
    el('tree-bloom').textContent = scene.treeBloom ? 'Show fruit' : 'Show blossoms';
    el('tree-bloom').setAttribute('aria-pressed', String(scene.treeBloom));
    document.querySelectorAll<HTMLButtonElement>('[data-stage]').forEach((b) => {
      const on = Number(b.dataset.stage) === scene.treeStage;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
  }
  for (const plant of ALL_PLANTS) {
    const button = document.createElement('button');
    button.className = 'plant-card';
    button.dataset.plant = plant.id;
    button.dataset.category = plant.category;
    button.setAttribute('aria-label', `Preview ${plant.label}`);
    const mature =
      art.crops.get(plant.id as ReviewCrop)?.[4] ??
      art.orchard.get(plant.id)?.[4] ??
      art.props.new.get(plant.id)!;
    const hero = copy(mature, plant.label);
    hero.className = 'plant-card-hero';
    const name = document.createElement('strong');
    name.textContent = plant.label;
    const category = document.createElement('span');
    category.textContent = plant.category;
    const row = document.createElement('div');
    row.className = 'plant-items';
    items(plant.id, row);
    button.append(hero, name, category, row);
    button.onclick = () => {
      if (REVIEW_CROPS.some((c) => c.id === plant.id)) {
        scene.setCropSpecies(plant.id as ReviewCrop);
        onCrop();
      } else {
        scene.treeStage = 3;
        scene.setTreeSpecies(plant.id as ReviewTree);
      }
      sync();
      dialog.close();
      el(
        REVIEW_CROPS.some((c) => c.id === plant.id) ? 'crop-preview' : 'growth-preview',
      ).scrollIntoView({ block: 'nearest' });
    };
    el('plant-cards').append(button);
  }
  const filter = () => {
    const term = el<HTMLInputElement>('plant-search').value.toLocaleLowerCase().trim();
    const category = el<HTMLSelectElement>('plant-filter').value;
    let count = 0;
    document.querySelectorAll<HTMLElement>('.plant-card').forEach((card) => {
      const match =
        (category === 'all' || card.dataset.category === category) &&
        card.textContent!.toLocaleLowerCase().includes(term);
      card.hidden = !match;
      if (match) count++;
    });
    el('plant-count').textContent = `${count} plants`;
  };
  el('plant-search').oninput = filter;
  el('plant-filter').onchange = filter;
  el<HTMLSelectElement>('crop-species').onchange = () => {
    scene.setCropSpecies(el<HTMLSelectElement>('crop-species').value as ReviewCrop);
    onCrop();
    sync();
  };
  el<HTMLSelectElement>('tree-species').onchange = () => {
    scene.setTreeSpecies(el<HTMLSelectElement>('tree-species').value as ReviewTree);
    sync();
  };
  el('tree-bloom').onclick = () => {
    scene.treeStage = 3;
    scene.setTreeBloom(!scene.treeBloom);
    sync();
  };
  opener.onclick = () => dialog.showModal();
  el('plants-close').onclick = () => dialog.close();
  dialog.addEventListener('click', (e) => {
    if (e.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
      dialog.close();
  });
  filter();
  sync();
  return { sync, dispose: () => dialog.remove() };
}
