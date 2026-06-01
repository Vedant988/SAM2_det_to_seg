import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const useStore = create(
    persist(
        (set, get) => ({
            // Project State
            projectName: '',
            setProjectName: (name) => set({ projectName: name }),

            recentProjects: [],
            addRecentProject: (project) => set((state) => {
                const newProjects = [
                    { ...project, id: crypto.randomUUID(), lastEdited: new Date().toISOString() },
                    ...state.recentProjects.filter(p => p.name !== project.name)
                ].slice(0, 5) // Keep last 5
                return { recentProjects: newProjects }
            }),
            deleteRecentProject: (projectId) => set((state) => ({
                recentProjects: state.recentProjects.filter(project => project.id !== projectId)
            })),

            // Image & Annotation State
            images: [],
            selectedImage: null,
            annotations: [], // Current image annotations
            allAnnotations: {}, // Store annotations for all images: { filename: [...annotations] }

            // Processing State
            isProcessing: false,
            processingProgress: { current: 0, total: 0, message: '' },

            // Actions
            setImages: (images) => set({ images }),
            setSelectedImage: (image) => set((state) => ({
                selectedImage: image,
                annotations: state.allAnnotations[image] || []
            })),
            setAnnotations: (annotations) => set((state) => {
                const newAllAnnotations = { ...state.allAnnotations }
                if (state.selectedImage) {
                    newAllAnnotations[state.selectedImage] = annotations
                }
                return { annotations, allAnnotations: newAllAnnotations }
            }),
            setAllAnnotations: (allAnnotations) => set({ allAnnotations }),
            addAnnotation: (annotation) => set((state) => ({ annotations: [...state.annotations, annotation] })),
            updateAnnotation: (id, newProps) => set((state) => ({
                annotations: state.annotations.map(ann => ann.id === id ? { ...ann, ...newProps } : ann)
            })),
            removeAnnotation: (id) => set((state) => ({
                annotations: state.annotations.filter(ann => ann.id !== id)
            })),
            setProcessing: (status) => set({ isProcessing: status }),
            setProcessingProgress: (progress) => set({ processingProgress: progress }),

            // Reset Project
            resetProject: () => set({
                projectName: '',
                images: [],
                selectedImage: null,
                annotations: [],
                allAnnotations: {},
                isProcessing: false,
                processingProgress: { current: 0, total: 0, message: '' }
            }),

            deleteImage: (filename) => set((state) => {
                const newAllAnnotations = { ...state.allAnnotations }
                delete newAllAnnotations[filename]

                return {
                    images: state.images.filter(img => img !== filename),
                    allAnnotations: newAllAnnotations,
                    selectedImage: state.selectedImage === filename ? null : state.selectedImage,
                    annotations: state.selectedImage === filename ? [] : state.annotations
                }
            })
        }),
        {
            name: 'yolo-sam2-storage', // unique name
            partialize: (state) => ({ recentProjects: state.recentProjects }), // only persist recentProjects
        }
    )
)
