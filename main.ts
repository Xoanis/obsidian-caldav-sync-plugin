import { App, Plugin, PluginSettingTab, Notice, Setting, TFile, CachedMetadata } from 'obsidian';
import { requestUrl, moment } from 'obsidian';
import { convertIcsCalendar, generateIcsCalendar, type IcsCalendar } from "ts-ics";
import { type IcsEvent } from "ts-ics";
import { v4 as uuidv4 } from 'uuid';

interface ObsidianEvent {
	date: string;
	start_time: string | undefined;
	end_time: string | undefined;
	summary: string;
	description: string;
	location: string;
	url: string | undefined;
	guid: string | undefined;
};

function tryCreateObsidianEvent(filename: string, metadata: CachedMetadata, content: string): ObsidianEvent | undefined {
	const frontmatter = metadata?.frontmatter;

	if (frontmatter && frontmatter.type && frontmatter.type === 'calendar-event') {
		if (frontmatter.date) {
			const description = content.slice(metadata?.frontmatterPosition!.end.offset + 1);
			return {
				date: frontmatter.date,
				start_time: frontmatter.start_time,
				end_time: frontmatter.end_time,
				summary: filename,
				description: description,
				location: frontmatter.location,
				url: frontmatter.url,
				guid: frontmatter.guid
			}
		}
	}

	return undefined;
}
interface ObsidianCalDAVPluginSettings {
	eventsDirectory: string;
	yandexUsername: string;
	yandexAppPassword: string;
	yandexCalendarUrl: string;
}

const DEFAULT_SETTINGS: ObsidianCalDAVPluginSettings = {
	eventsDirectory: "",
	yandexUsername: "",
	yandexAppPassword: "",
	yandexCalendarUrl: ""
}

export default class ObsidianCalDAVPlugin extends Plugin {
	settings: ObsidianCalDAVPluginSettings;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new ObsidianCalDAVPluginSettingsTab(this.app, this));

		this.addCommand({
			id: 'sync-event',
			name: 'Sync event with calendar',
			callback: async () => {
				const active_editor = this.app.workspace.activeEditor;
				if (active_editor && active_editor.file) {
					await this.syncEventFile(active_editor.file);
				} else {
					new Notice('Нет активного файла для синхронизации');
				}
			}
		});

		this.addCommand({
			id: 'sync-all-events',
			name: 'Sync all events with calendar',
			callback: async () => {
				const md_files = this.app.vault.getMarkdownFiles().filter(file =>
					file.path.startsWith(`${this.settings.eventsDirectory}/`)
				);

				const my_set = new Set<string>();
				await Promise.all(md_files.map(async (doc) => {
					const guid = await this.getUUIDFromEventFile(doc);
					if (guid) my_set.add(guid);
					await this.syncEventFile(doc);
				}));

				const calendar = await this.fetchCalendar();
				if (calendar && calendar.events) {
					for (const value of calendar.events) {
						if (!my_set.has(value.uid)) {
							const startMoment = moment(value.start.date);
							const endMoment = value.end ? moment(value.end.date) : null;
							const props: Record<string, any> = {
								"type": "calendar-event",
								"date": startMoment.format('YYYY-MM-DD'),
								"guid": value.uid,
								"url": value.url,
								"location": value.location
							};
							if (value.start.type === 'DATE-TIME') {
								props["start_time"] = startMoment.format('HH:mm');
								if (endMoment && endMoment.format('YYYY-MM-DD') === startMoment.format('YYYY-MM-DD')) {
									props["end_time"] = endMoment.format('HH:mm');
								} else if (endMoment) {
									new Notice('Многосуточное событие не поддерживается');
									continue;
								}
							}
							const safeFileName = value.summary.replace(/[\/\\:]/g, '_');
							await this.createFileWithProps(this.settings.eventsDirectory, safeFileName, value.description || '', props);
						}
					}
					new Notice('Все события синхронизированы');
				}
			}
		});
	}

	async createFileWithProps(
		folderPath: string,
		fileName: string,
		content: string,
		props: Record<string, any>
	): Promise<TFile> {
		// Формируем полный путь
		const fullPath = `${folderPath}/${fileName}.md`;

		// Создаем frontmatter из props
		const md_file = `---\n${Object.entries(props)
			.map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
			.join('\n')}\n---\n\n${content}`;

		// Создаем файл
		return await this.app.vault.create(fullPath, md_file);
	}

	async getUUIDFromEventFile(doc: TFile) {
		const fileCache = this.app.metadataCache.getFileCache(doc);
		const frontmatter = fileCache?.frontmatter;
		return frontmatter && frontmatter.guid ? frontmatter.guid : '';
	}

	async syncEventFile(doc: TFile) {
		const content = await this.app.vault.read(doc);
		const fileCache = this.app.metadataCache.getFileCache(doc);
		const event = tryCreateObsidianEvent(doc.basename, fileCache!, content);
		if (event) {
			if (await this.syncEvent(event)) {
				this.app.fileManager.processFrontMatter(doc, (frontmatter) => {
					frontmatter['guid'] = event.guid;
					frontmatter['url'] = event.url;
				});
			}
		}
	}

	onunload() {

	}

	async syncEvent(local_event: ObsidianEvent) {
		const now = moment().toDate();
		const uuid = local_event.guid || `${uuidv4()}@obsidian.md`;

		const event: IcsEvent = {
			summary: local_event.summary,
			description: local_event.description,
			uid: uuid,
			created: { date: now },
			stamp: { date: now },
			location: local_event.location,
		};

		if (local_event.start_time) {
			const start = new Date(`${local_event.date}T${local_event.start_time}:00`);
			const end = local_event.end_time ? new Date(`${local_event.date}T${local_event.end_time}:00`) : new Date(start.getTime() + 3600000);
			event.start = { date: start, type: "DATE-TIME" };
			event.end = { date: end, type: "DATE-TIME" };
		} else {
			const start = new Date(local_event.date);
			const end = new Date(start.getTime() + 86400000);
			event.start = { date: start, type: "DATE" };
			event.end = { date: end, type: "DATE" };
		}

		const calend: IcsCalendar = {
			prodId: "-//Example Corp.//CalDAV Client//EN",
			version: "2.0",
			events: [event]
		};

		const icsString = generateIcsCalendar(calend);
		const auth = btoa(`${this.settings.yandexUsername}:${this.settings.yandexAppPassword}`);
		const url = `${this.settings.yandexCalendarUrl}${this.settings.yandexCalendarUrl.endsWith('/') ? '' : '/'}${event.uid}`;

		try {
			const response_on_put = await requestUrl({
				url: url,
				method: "PUT",
				headers: {
					"Authorization": `Basic ${auth}`,
					"Content-Type": "text/calendar"
				},
				body: icsString
			});

			if (response_on_put.status.toString().startsWith("2")) {
				const response_on_check = await requestUrl({
					url: `${url}.ics`,
					method: "PROPFIND",
					headers: { "Authorization": `Basic ${auth}` }
				});

				if (response_on_check.status.toString().startsWith("2")) {
					const calendar = convertIcsCalendar(undefined, response_on_check.text);
					local_event.guid = event.uid;
					local_event.url = calendar.events?.[0]?.url;
					return true;
				}
			}
			return false;
		} catch (error) {
			console.error("Ошибка синхронизации:", error);
			return false;
		}
	}

	async fetchCalendar(): Promise<IcsCalendar | undefined> {

		const auth = btoa(`${this.settings.yandexUsername}:${this.settings.yandexAppPassword}`);
		const clndr_url = this.settings.yandexCalendarUrl + (this.settings.yandexCalendarUrl.endsWith('/') ? '' : "/")


		const response = await requestUrl(
			{
				url: clndr_url,
				method: "PROPFIND",
				headers: {
					"Authorization": `Basic ${auth}`
				}
			}
		)

		if (String(response.status).startsWith("2")) {
			return convertIcsCalendar(undefined, response.text);
		} else {
			console.error("Request error", response.status);
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}


class ObsidianCalDAVPluginSettingsTab extends PluginSettingTab {
	plugin: ObsidianCalDAVPlugin;

	constructor(app: App, plugin: ObsidianCalDAVPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();
		containerEl.createEl('h2', { text: 'Настройки Яндекс.Календаря' });

		new Setting(containerEl)
			.setName('Директория для событий')
			.setDesc('Папка в хранилище, где будут храниться файлы событий (например, "Календарь").')
			.addText(text => text
				.setPlaceholder('Например: Календарь/События')
				.setValue(this.plugin.settings.eventsDirectory)
				.onChange(async (value) => {
					this.plugin.settings.eventsDirectory = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Логин Яндекс')
			.setDesc('Ваш логин на Яндексе (например, username@yandex.ru).')
			.addText(text => text
				.setPlaceholder('username@yandex.ru')
				.setValue(this.plugin.settings.yandexUsername)
				.onChange(async (value) => {
					this.plugin.settings.yandexUsername = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Пароль приложения Яндекс')
			.setDesc('Создайте пароль приложения в настройках безопасности вашего аккаунта Яндекс для этого плагина.')
			.addText(text => text
				.setPlaceholder('Пароль приложения')
				.setValue(this.plugin.settings.yandexAppPassword)
				.onChange(async (value) => {
					this.plugin.settings.yandexAppPassword = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('URL календаря Яндекс')
			.setDesc('Полный URL вашего CalDAV календаря на Яндексе. Пример: https://caldav.yandex.ru/calendars/user@yandex.ru/id-календаря/')
			.addText(text => text
				.setPlaceholder('https://caldav.yandex.ru/calendars/...')
				.setValue(this.plugin.settings.yandexCalendarUrl)
				.onChange(async (value) => {
					this.plugin.settings.yandexCalendarUrl = value;
					await this.plugin.saveSettings();
				}));
	}
}
