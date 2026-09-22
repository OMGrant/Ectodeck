export type DeviceInfo = {
	id: string;
	name: string;
	rows: number;
	columns: number;
	encoders: number;
	touchpoints: number;
	infobars: number;
	encoder_placement: string;
	has_background: boolean;
	panel: PanelInfo | null;
	type: number;
};

export type PanelInfo = {
	width: number;
	height: number;
	keys_x: number;
	keys_y: number;
	keys_width: number;
	keys_height: number;
};
