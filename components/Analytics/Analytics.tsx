'use client'

import { init, push } from '@socialgouv/matomo-next';
import { usePathname } from 'next/navigation';
import { useEffect, useRef  } from 'react';

const Analytics = ({url, siteId}: {url: string, siteId: string}) => {

	const pathname = usePathname();
	const isInitialLoad = useRef(true);

	useEffect(() => {
		try {
			console.log('Matomo initializing');
			init({ url, siteId, disableCookies: true });
			return () => push(['HeatmapSessionRecording::disable']);
		} catch {
			console.error('Matomo failed to initialize');
		}
	}, [url, siteId]);

	useEffect(() => {
		if (isInitialLoad.current) {
			isInitialLoad.current = false;

		} else {
			if (pathname) {
				try {
					push(['setCustomUrl', pathname]);
					push(['trackPageView']);
				} catch {
					console.error('Matomo failed to track page view');
				}
			}
		}
	}, [pathname])

	return null
}

export default Analytics;
