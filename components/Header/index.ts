export {default} from './Header';

export * from "./types"

export interface HeaderProps {
	pages: {label: string; path: string;}[];
}
