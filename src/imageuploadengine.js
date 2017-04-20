/**
 * @license Copyright (c) 2003-2017, CKSource - Frederico Knabben. All rights reserved.
 * For licensing, see LICENSE.md.
 */

/**
 * @module upload/imageuploadengine
 */

import Plugin from '@ckeditor/ckeditor5-core/src/plugin';
import FileRepository from './filerepository';
import ImageUploadCommand from './imageuploadcommand';
import ImageUploadProgress from './imageuploadprogress';
import Notification from '@ckeditor/ckeditor5-ui/src/notification/notification';
import { isImageType } from './utils';

/**
 * Image upload engine plugin.
 *
 * @extends module:core/plugin~Plugin
 */
export default class ImageUploadEngine extends Plugin {
	/**
	 * @inheritDoc
	 */
	static get requires() {
		return [ FileRepository, Notification, ImageUploadProgress ];
	}

	/**
	 * @inheritDoc
	 */
	init() {
		const editor = this.editor;
		const doc = editor.document;
		const schema = doc.schema;

		// Setup schema to allow uploadId for images.
		schema.allow( { name: 'image', attributes: [ 'uploadId' ], inside: '$root' } );
		schema.allow( { name: 'image', attributes: [ 'uploadId', 'uploadStatus' ], inside: '$root' } );
		schema.requireAttributes( 'image', [ 'uploadId' ] );

		// Register imageUpload command.
		editor.commands.set( 'imageUpload', new ImageUploadCommand( editor ) );

		// Execute imageUpload command when image is dropped or pasted.
		editor.editing.view.on( 'clipboardInput', ( evt, data ) => {
			for ( const file of data.dataTransfer.files ) {
				if ( isImageType( file ) ) {
					editor.execute( 'imageUpload', { file } );
					evt.stop();
				}
			}
		} );

		// Listen on document changes and start upload process when image with `uploadId` attribute is present.
		doc.on( 'change', ( evt, type, data, batch ) => {
			if ( type === 'insert' ) {
				for ( const value of data.range ) {
					if ( value.type === 'elementStart' && value.item.name === 'image' ) {
						const imageElement = value.item;
						const uploadId = imageElement.getAttribute( 'uploadId' );
						const fileRepository = editor.plugins.get( FileRepository );

						if ( uploadId ) {
							const loader = fileRepository.loaders.get( uploadId );

							if ( loader && loader.status == 'idle' ) {
								this.load( loader, batch, imageElement );
							}
						}
					}
				}
			}
		} );
	}

	/**
	 * Performs image loading. Image is read from the disk and temporary data is displayed, after uploading process
	 * is complete we replace temporary data with target image from the server.
	 *
	 * @protected
	 * @param {module:upload/filerepository~FileLoader} loader
	 * @param {module:engine/model/batch~Batch} batch
	 * @param {module:engine/model/element~Element} imageElement
	 */
	load( loader, batch, imageElement ) {
		const editor = this.editor;
		const doc = editor.document;
		const fileRepository = editor.plugins.get( FileRepository );
		const notification = editor.plugins.get( Notification );

		doc.enqueueChanges( () => {
			batch.setAttribute( imageElement, 'uploadStatus', 'reading' );
		} );

		loader.read()
			.then( data => {
				const viewFigure = editor.editing.mapper.toViewElement( imageElement );
				const viewImg = viewFigure.getChild( 0 );
				viewImg.setAttribute( 'src', data );
				editor.editing.view.render();

				doc.enqueueChanges( () => {
					batch.setAttribute( imageElement, 'uploadStatus', 'uploading' );
				} );

				return loader.upload();
			} )
			.then( data => {
				doc.enqueueChanges( () => {
					batch.setAttribute( imageElement, 'uploadStatus', 'complete' );
					batch.setAttribute( imageElement, 'src', data.original );
				} );

				clean();
			} )
			.catch( msg => {
				// Might be 'aborted'.
				if ( loader.status == 'error' ) {
					notification.showWarning( msg, { namespace: 'upload' } );
				}

				clean();
			} );

		function clean() {
			doc.enqueueChanges( () => {
				batch.removeAttribute( imageElement, 'uploadId' );
				batch.removeAttribute( imageElement, 'uploadStatus' );
			} );

			fileRepository.destroyLoader( loader );
		}
	}
}
