/** @type {import('next-sitemap').IConfig} */
module.exports = {
	siteUrl: `https://${process.env.HOSTNAME}` || 'https://example.com',
	output: "export"
}
