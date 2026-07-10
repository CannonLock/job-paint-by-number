'use client'

import Toolbar from "@mui/material/Toolbar";
import Box from "@mui/material/Box";
import Link from "@mui/material/Link";
import Button from "@mui/material/Button";
import React from "react";

import Title from "@/components/Header/Title";
import {NavigationItem} from "@/components/Header";

const DesktopHeader = ({ pages }: { pages: NavigationItem[] }) => {
	// Reserve enough space so the centered nav won't overlap the title.
	// If the title grows wider than this, the nav will naturally get "pushed" / clipped first.
	const leftReservedWidthPx = 320;

	return (
		<Toolbar disableGutters>
			<Box
				sx={{
					position: 'relative',
					width: '100%',
					display: 'flex',
					alignItems: 'center',
				}}
			>
				{/* Left: title */}
				<Box sx={{ flex: '0 0 auto', minWidth: 0 }}>
					<Title />
				</Box>

				{/* Center: nav, centered on full header width but constrained to not overlap left */}
				<Box
					sx={{
						position: 'absolute',
						left: '50%',
						transform: 'translateX(-50%)',
						display: 'flex',
						justifyContent: 'center',
						// Prevent overlap with the left title by reserving space on both sides.
						maxWidth: `calc(100% - ${leftReservedWidthPx * 2}px)`,
						overflow: 'hidden',
						whiteSpace: 'nowrap',
					}}
				>
					{pages
						.filter((p) => typeof p.path === 'string' && p.path.length > 0)
						.map(({ label, path }) => (
							<Link key={path} href={path} underline="none" sx={{ display: 'inline-flex' }}>
								<Button sx={{ my: 2, color: 'white', display: 'block' }}>{label}</Button>
							</Link>
						))}
				</Box>

				{/* Right: spacer column to balance the left (so centering looks right). */}
				<Box sx={{ flex: '0 0 auto', width: leftReservedWidthPx }} />
			</Box>
		</Toolbar>
	);
};

export default DesktopHeader;
