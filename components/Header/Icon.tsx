import ChtcIconWEBP from "@/public/logos/chtc.webp";
import ChtcIconPNG from "@/public/logos/chtc.png";
import React, {CSSProperties} from "react";

const Icon = ({size = "50px"}: {size?: CSSProperties['width']}) => {

	const style = {
		height: "auto",
		width: '100px',
	}

	return (
		<picture>
			<source
					srcSet={ChtcIconWEBP.src}
					type="image/webp"
					style={style}
			/>
			<img
					src={ChtcIconPNG.src}
					alt="Badger Hub Icon"
					style={style}
			/>
		</picture>
	)
}

export default Icon;
