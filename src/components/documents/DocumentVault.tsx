'use client'

/**
 * 🔒 V22-14 (Batch D, Phase 7g) — Document Vault
 *
 * Stores and manages business documents: bills, invoices, GST certificates,
 * bank statements, ID proofs. Files are uploaded to Cloudinary, metadata
 * stored in the Document table.
 *
 * Features:
 * - Upload (images + PDFs, max 10MB)
 * - Category filter (All, Bills, Invoices, GST Certificates, Bank Statements, ID Proofs, Other)
 * - Grid view with file type icons
 * - Preview (opens Cloudinary URL in new tab)
 * - Delete (soft-delete + Cloudinary cleanup)
 * - Search by name
 */

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, useRef, useEffect } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/common/EmptyState'
import { offlineFetch } from '@/lib/offline-fetch'
import { cn, formatDate } from '@/lib/utils'
import { haptic } from '@/lib/haptic'
import { toast as sonnerToast } from 'sonner'
import { useConfirmDialog } from '@/hooks/use-confirm-dialog'
import { readError } from '@/lib/read-error'
import {
  Upload, FileText, FileImage, FileCheck, Banknote, IdCard,
  File, Trash2, Search, Loader2, X, Download, FolderOpen,
} from 'lucide-react'

const CATEGORIES = [
  { value: 'all', label: 'All', icon: FolderOpen, color: 'text-slate-600 dark:text-slate-400', bg: 'bg-slate-100 dark:bg-slate-800' },
  { value: 'bill', label: 'Bills', icon: FileText, color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-100 dark:bg-amber-950' },
  { value: 'invoice', label: 'Invoices', icon: FileCheck, color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-100 dark:bg-emerald-950' },
  { value: 'gst-certificate', label: 'GST Certificates', icon: FileCheck, color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-100 dark:bg-blue-950' },
  { value: 'bank-statement', label: 'Bank Statements', icon: Banknote, color: 'text-violet-600 dark:text-violet-400', bg: 'bg-violet-100 dark:bg-violet-950' },
  { value: 'id-proof', label: 'ID Proofs', icon: IdCard, color: 'text-rose-600 dark:text-rose-400', bg: 'bg-rose-100 dark:bg-rose-950' },
  { value: 'other', label: 'Other', icon: File, color: 'text-slate-600 dark:text-slate-400', bg: 'bg-slate-100 dark:bg-slate-800' },
] as const

export function DocumentVault() {
  const queryClient = useQueryClient()
  const { confirmDialog, dialog: confirmDialogEl } = useConfirmDialog()
  const [filter, setFilter] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false)
  const [uploadName, setUploadName] = useState('')
  const [uploadCategory, setUploadCategory] = useState('bill')
  const [uploadNotes, setUploadNotes] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pendingFileRef = useRef<File | null>(null)

  // 🔒 AUDIT V23 FIX §9.8: Escape key to close upload dialog (accessibility)
  useEffect(() => {
    if (!uploadDialogOpen) return
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !uploading) {
        setUploadDialogOpen(false)
        pendingFileRef.current = null
        if (fileInputRef.current) fileInputRef.current.value = ''
      }
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [uploadDialogOpen, uploading])

  // Fetch documents
  const { data, isLoading } = useQuery({
    queryKey: ['documents', filter],
    queryFn: async () => {
      const url = filter === 'all' ? '/api/documents' : `/api/documents?category=${filter}`
      const r = await offlineFetch(url)
      if (!r.ok) throw new Error(await readError(r))
      return r.json()
    },
  })

  const documents = (data?.documents || []).filter((d: any) =>
    !search || d.name.toLowerCase().includes(search.toLowerCase())
  )

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // 🔒 AUDIT V23 FIX §6a: Client-side size check.
    // Vercel serverless rejects request bodies over 4.5MB. Base64 encoding
    // adds ~33%, so the effective file size limit is ~3.3MB. We check at 3MB
    // to give a clear error message before the upload attempt.
    const MAX_FILE_SIZE = 3 * 1024 * 1024 // 3MB
    if (file.size > MAX_FILE_SIZE) {
      sonnerToast.error('File too large', {
        description: `Maximum file size is 3MB. Your file is ${(file.size / (1024 * 1024)).toFixed(1)}MB. Try compressing or cropping the image.`,
        duration: 8000,
      })
      e.target.value = '' // reset input so the same file can be re-selected
      return
    }

    // 🔒 AUDIT V23 FIX §6c: Server-side file type whitelist.
    // Only accept images and PDFs — reject executables, HTML, etc.
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']
    if (!allowedTypes.includes(file.type)) {
      sonnerToast.error('Unsupported file type', {
        description: `Only images (JPEG, PNG, WebP, GIF) and PDF files are allowed.`,
        duration: 6000,
      })
      e.target.value = ''
      return
    }

    pendingFileRef.current = file
    setUploadName(file.name.replace(/\.[^/.]+$/, ''))  // filename without extension
    setUploadDialogOpen(true)
  }

  const handleUpload = async () => {
    const file = pendingFileRef.current
    if (!file) {
      sonnerToast.error('No file selected')
      return
    }
    if (!uploadName.trim()) {
      sonnerToast.error('Enter a name for the document')
      return
    }

    setUploading(true)
    try {
      // Convert file to base64
      const reader = new FileReader()
      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = reject
        reader.readAsDataURL(file)
      })

      const r = await offlineFetch('/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: uploadName.trim(),
          category: uploadCategory,
          fileType: file.type,
          fileData: base64,
          notes: uploadNotes.trim() || undefined,
        }),
      })

      if (!r.ok) {
        const err = await r.json().catch(() => ({}))
        throw new Error(err.error || 'Upload failed')
      }

      sonnerToast.success('Document uploaded successfully')
      setUploadDialogOpen(false)
      setUploadName('')
      setUploadNotes('')
      pendingFileRef.current = null
      if (fileInputRef.current) fileInputRef.current.value = ''
      queryClient.invalidateQueries({ queryKey: ['documents'] })
    } catch (err: any) {
      sonnerToast.error('Upload failed', { description: String(err?.message || err).slice(0, 200) })
    } finally {
      setUploading(false)
    }
  }

  const handleDelete = async (docId: string, docName: string) => {
    if (!await confirmDialog(`Delete "${docName}"? This cannot be undone.`, {
      title: 'Delete Document',
      confirmLabel: 'Delete',
      destructive: true,
    })) return

    haptic.warning()
    try {
      const r = await offlineFetch(`/api/documents?id=${docId}`, { method: 'DELETE' })
      if (!r.ok) throw new Error(await readError(r))
      sonnerToast.success('Document deleted')
      queryClient.invalidateQueries({ queryKey: ['documents'] })
    } catch {
      sonnerToast.error("Couldn\'t delete the document")
    }
  }

  const getFileIcon = (fileType: string, category: string) => {
    if (fileType.startsWith('image/')) return FileImage
    if (category === 'gst-certificate') return FileCheck
    if (category === 'bank-statement') return Banknote
    if (category === 'id-proof') return IdCard
    if (category === 'invoice') return FileCheck
    if (category === 'bill') return FileText
    return File
  }

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <div className="space-y-4">
      {/* Header + Upload button */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-bold">Document Vault</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Store bills, invoices, GST certificates & more securely
          </p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          onChange={handleFileSelect}
          className="hidden"
          accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
        />
        <Button
          onClick={() => fileInputRef.current?.click()}
          className="bg-gradient-saffron gap-2"
        >
          <Upload className="w-4 h-4" />
          Upload Document
        </Button>
      </div>

      {/* Search + Filter */}
      <Card className="shadow-card border-border/60">
        <CardContent className="p-3 lg:p-4">
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
            <div className="relative flex-1 w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search documents..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex gap-1.5 overflow-x-auto scrollbar-hide -mx-1 px-1">
              {CATEGORIES.map(cat => {
                const Icon = cat.icon
                return (
                  <button
                    key={cat.value}
                    onClick={() => { haptic.click(); setFilter(cat.value) }}
                    className={cn(
                      'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition flex-shrink-0',
                      filter === cat.value
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'bg-muted text-muted-foreground hover:bg-muted/80',
                    )}
                  >
                    <Icon className="w-3 h-3" />
                    {cat.label}
                  </button>
                )
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Documents grid */}
      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}
        </div>
      ) : documents.length === 0 ? (
        <Card className="shadow-card border-border/60">
          <CardContent className="p-0">
            <EmptyState
              icon={FolderOpen}
              title={search ? 'No documents match your search' : 'No documents yet'}
              description={search
                ? 'Try a different search term or clear the filters.'
                : 'Upload bills, invoices, GST certificates, bank statements, or ID proofs to keep them organized and accessible.'}
              action={!search ? { label: 'Upload Document', onClick: () => fileInputRef.current?.click() } : undefined}
              color="violet"
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {documents.map((doc: any) => {
            const Icon = getFileIcon(doc.fileType, doc.category)
            const catMeta = CATEGORIES.find(c => c.value === doc.category) || CATEGORIES[CATEGORIES.length - 1]
            return (
              <Card key={doc.id} className="card-hover shadow-card border-border/60 overflow-hidden group">
                <CardContent className="p-3">
                  {/* File preview / icon */}
                  <div className={cn(
                    'aspect-square rounded-lg flex items-center justify-center mb-2 relative',
                    catMeta.bg,
                  )}>
                    {doc.fileType.startsWith('image/') ? (
                      <img
                        src={doc.viewUrl || doc.cloudinaryUrl}
                        alt={doc.name}
                        className="w-full h-full object-cover rounded-lg"
                        loading="lazy"
                      />
                    ) : (
                      <Icon className={cn('w-12 h-12', catMeta.color)} />
                    )}
                    {/* Delete button (appears on hover) */}
                    <button
                      onClick={() => handleDelete(doc.id, doc.name)}
                      className="absolute top-1.5 right-1.5 w-7 h-7 rounded-lg bg-rose-500/90 text-white opacity-0 group-hover:opacity-100 transition flex items-center justify-center hover:bg-rose-600"
                      title="Delete"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {/* Name + category */}
                  <p className="text-sm font-medium truncate" title={doc.name}>{doc.name}</p>
                  <div className="flex items-center justify-between mt-1">
                    <Badge variant="outline" className="text-3xs">{catMeta.label}</Badge>
                    <span className="text-3xs text-muted-foreground">{formatFileSize(doc.fileSize)}</span>
                  </div>
                  <p className="text-3xs text-muted-foreground mt-1">{formatDate(doc.uploadedAt)}</p>
                  {/* Open button */}
                  <a
                    href={doc.viewUrl || doc.cloudinaryUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 w-full inline-flex items-center justify-center gap-1 py-1.5 rounded-lg border border-border text-2xs font-medium hover:bg-muted transition"
                  >
                    <Download className="w-3 h-3" />
                    Open
                  </a>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Upload dialog */}
      {uploadDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-card rounded-2xl shadow-2xl max-w-md w-full">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h3 className="font-bold text-sm">Upload Document</h3>
              <button
                onClick={() => { setUploadDialogOpen(false); pendingFileRef.current = null; if (fileInputRef.current) fileInputRef.current.value = '' }}
                className="p-1.5 rounded-lg hover:bg-muted"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              {/* File info */}
              {pendingFileRef.current && (
                <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/50">
                  <File className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  <span className="text-xs truncate flex-1">{pendingFileRef.current.name}</span>
                  <span className="text-3xs text-muted-foreground">{formatFileSize(pendingFileRef.current.size)}</span>
                </div>
              )}
              {/* Name */}
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Document Name</label>
                <Input
                  value={uploadName}
                  onChange={(e) => setUploadName(e.target.value)}
                  placeholder="e.g. GST Certificate March 2026"
                />
              </div>
              {/* Category */}
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Category</label>
                <div className="flex gap-1.5 flex-wrap">
                  {CATEGORIES.filter(c => c.value !== 'all').map(cat => (
                    <button
                      key={cat.value}
                      onClick={() => setUploadCategory(cat.value)}
                      className={cn(
                        'px-2.5 py-1 rounded-full text-2xs font-medium transition',
                        uploadCategory === cat.value
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-muted-foreground hover:bg-muted/80',
                      )}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>
              </div>
              {/* Notes */}
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Notes (optional)</label>
                <Input
                  value={uploadNotes}
                  onChange={(e) => setUploadNotes(e.target.value)}
                  placeholder="Any notes about this document..."
                />
              </div>
            </div>
            <div className="p-4 border-t border-border flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => { setUploadDialogOpen(false); pendingFileRef.current = null; if (fileInputRef.current) fileInputRef.current.value = '' }}
                disabled={uploading}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 bg-gradient-saffron gap-2"
                onClick={handleUpload}
                disabled={uploading}
              >
                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {uploading ? 'Uploading...' : 'Upload'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {confirmDialogEl}
    </div>
  )
}
