export type ManagedImage = {
	embed: string;
	parentDir: string;
	imageDirectory: string;
	filename: string;
};

export function managedImageFromCopy({
	embed,
	parentDir,
	imageDirectory,
	relativePath,
}: {
	embed: string;
	parentDir: string;
	imageDirectory: string;
	relativePath: string;
}): ManagedImage {
	const filename = relativePath.split('/').pop();
	if (!filename) throw new Error('Copied image path has no filename');

	return { embed, parentDir, imageDirectory, filename };
}
