import type { MetadataRoute } from 'next'

export const dynamic = 'force-static'

export default function robots(): MetadataRoute.Robots {
	return {
		rules: {
			allow: ['/'],
			disallow: [],
		},
		sitemap: `https://${process.env.HOSTNAME}/sitemap.xml`,
		host: `https://${process.env.HOSTNAME}`
	}
}