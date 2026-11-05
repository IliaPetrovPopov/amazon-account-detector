import { MARKETPLACES } from './marketplaces';
import { authStore, loadSelectedMarketplace, nameStore, pinStore } from './store';
import { badgeView } from './view';

/** Shows the chosen marketplace's state on the toolbar icon, so it is visible without opening the popup. */
export async function refreshBadge(): Promise<void> {
  const id = await loadSelectedMarketplace();
  const [record, pin, names] = await Promise.all([authStore.get(id), pinStore.get(id), nameStore.get()]);
  const view = badgeView(record, MARKETPLACES[id], Date.now(), pin, names);
  await Promise.all([
    chrome.action.setBadgeText({ text: view.text }),
    chrome.action.setBadgeBackgroundColor({ color: view.color }),
    chrome.action.setBadgeTextColor({ color: view.textColor }),
    chrome.action.setTitle({ title: view.title }),
  ]);
}
