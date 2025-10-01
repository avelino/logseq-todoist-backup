import {
  TOOLBAR_BUTTON_CLASS,
  TOOLBAR_ICON_CLASS,
  TOOLBAR_ICON_IMG_CLASS,
  TOOLBAR_KEY,
} from "./constants";

export function provideStyles() {
  logseq.provideStyle(`
    .${TOOLBAR_BUTTON_CLASS} {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 1.5rem;
      height: 1.5rem;
      padding: 0;
    }

    .${TOOLBAR_BUTTON_CLASS} .${TOOLBAR_ICON_CLASS} {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 1rem;
      line-height: 1;
    }

    .${TOOLBAR_BUTTON_CLASS}:hover {
      opacity: 0.8;
    }

    .${TOOLBAR_ICON_IMG_CLASS} {
      width: 1.25rem;
      height: 1.25rem;
      object-fit: contain;
    }
  `);
}

export function registerCommands(onSync: () => Promise<void>) {
  logseq.App.registerCommandPalette(
    {
      key: TOOLBAR_KEY,
      label: "Todoist: Sync backup",
    },
    onSync
  );
}

export function registerToolbar(iconUrl: string) {
  logseq.App.registerUIItem("toolbar", {
    key: TOOLBAR_KEY,
    template: `
      <a
        class="button ${TOOLBAR_BUTTON_CLASS}"
        data-on-click="syncTodoistBackup"
        title="Todoist: Sync backup"
      >
        <span class="${TOOLBAR_ICON_CLASS}" aria-hidden="true">
          <img src="${iconUrl}" class="${TOOLBAR_ICON_IMG_CLASS}" alt="Todoist backup" />
        </span>
      </a>
    `,
  });
}
