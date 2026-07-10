
import bundleAnalyzer from '@next/bundle-analyzer'

/** @type {import('next').NextConfig} */
const nextConfig = {
	// Configure `pageExtensions` to include markdown and MDX files
	pageExtensions: ['js', 'jsx', 'md', 'mdx', 'ts', 'tsx'],
	basePath: process.env.NEXT_PUBLIC_BASE_PATH,
	output: "export",
	trailingSlash: true,
	// Image Optimizer https://www.npmjs.com/package/next-image-export-optimizer?activeTab=readme
	images: {
		loader: "custom",
		imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
		deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
	},
	transpilePackages: ["next-image-export-optimizer"],
	env: {
		nextImageExportOptimizer_imageFolderPath: "public/images",
		nextImageExportOptimizer_exportFolderPath: "out",
		nextImageExportOptimizer_quality: "75",
		nextImageExportOptimizer_storePicturesInWEBP: "true",
		nextImageExportOptimizer_exportFolderName: "nextImageExportOptimizer",
		nextImageExportOptimizer_generateAndUseBlurImages: "true",
		nextImageExportOptimizer_remoteImageCacheTTL: "0",
	},
};

const withBundleAnalyzer = bundleAnalyzer({
	enabled: process.env.ANALYZE === 'true',
})



export default withBundleAnalyzer(nextConfig);
